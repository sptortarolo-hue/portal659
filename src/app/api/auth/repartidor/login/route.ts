import { NextResponse } from "next/server";
import { queryMany, queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { toE164, phoneMatchCandidates } from "@/lib/phone";

// Login del repartidor: teléfono + contraseña.
// Solo entra si su vínculo está activo (status='active').
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  // E.164 (sin 0 ni 15), igual que el alta y el claim. El match usa todas
  // las variantes para seguir aceptando filas legacy en dígitos.
  const phone = toE164(String(body.phone ?? ""));
  // Trim simétrico con el claim (espacio fantasma del teclado móvil).
  const password = String(body.password ?? "").trim();

  if (!phone || !password) {
    return NextResponse.json({ error: "Teléfono y contraseña son requeridos" }, { status: 400 });
  }

  // DIAG temporal (sacar cuando se resuelva el caso 2214815846): loguea la
  // etapa del fallo SIN secretos (nunca password ni hash). Ver con:
  // docker logs portal659-app 2>&1 | grep repartidor-login
  const diag = (stage: string, extra?: Record<string, unknown>) =>
    console.log(`[repartidor-login] ${stage}`, JSON.stringify({ phone, ...extra }));

  // Un mismo teléfono puede estar vinculado a varios comercios (una fila
  // vendor_staff por comercio, cada una con su profile). Se prueban todas
  // las filas activas hasta que una verifique la contraseña: con LIMIT 1 se
  // podía verificar contra el vínculo equivocado y dar "incorrectos" con
  // datos correctos.
  const rows = await queryMany<{
    id: string;
    profile_id: string;
    vendor_id: string;
    password_hash: string | null;
    email: string | null;
    status: string;
    token_version: number;
  }>(
    `SELECT vs.id, vs.profile_id, vs.vendor_id, p.password_hash, p.email, p.token_version, vs.status
     FROM vendor_staff vs
     JOIN profiles p ON p.id = vs.profile_id
     WHERE vs.phone = ANY($1) AND vs.status != 'revoked'
     ORDER BY vs.created_at ASC`,
    [phoneMatchCandidates(phone)]
  );

  diag("rows", {
    count: rows?.length ?? 0,
    rows: (rows || []).map((r) => ({
      id: r.id.slice(0, 8),
      status: r.status,
      hasHash: !!r.password_hash,
      hashAlg: r.password_hash ? r.password_hash.slice(0, 11) : null,
    })),
  });

  let staff: {
    id: string;
    profile_id: string;
    vendor_id: string;
    password_hash: string | null;
    email: string | null;
    status: string;
    token_version: number;
  } | null = null;
  if (rows && rows.length > 0) {
    for (const r of rows) {
      if (r.status !== "active" || !r.password_hash) continue;
      const verified = await verifyPassword(r.password_hash, password);
      diag("verify", { row: r.id.slice(0, 8), verified });
      if (verified) {
        staff = r;
        break;
      }
    }
    // Hubo filas pero ninguna verificó: credenciales mal (mensaje genérico
    // a propósito, igual que el login normal).
    if (!staff) {
      diag("fail-credentials");
      return NextResponse.json({ error: "Teléfono o contraseña incorrectos" }, { status: 401 });
    }
  }

  if (!staff) {
    diag("fail-no-rows");
    return NextResponse.json({ error: "No sos repartidor de este comercio o te desvincularon" }, { status: 401 });
  }
  diag("ok", { row: staff.id.slice(0, 8) });

  const vendor = await queryOne<{ id: string; store_name: string }>(
    `SELECT id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [staff.vendor_id]
  );

  const accessToken = await signAccessToken({
    id: staff.profile_id,
    email: staff.email || `rep_${phone}@portal659.local`,
    role: "buyer",
    tokenVersion: staff.token_version,
  });

  const response = NextResponse.json({
    ok: true,
    // La app nativa de Reparto se autentica con Bearer (sin cookies): expone
    // el token igual que el login normal (session.access_token). `profile.id`
    // le permite matchear assigned_to para "Mis entregas".
    session: { access_token: accessToken, refresh_token: accessToken },
    profile: { id: staff.profile_id },
    vendor: { id: vendor?.id, store_name: vendor?.store_name },
  });
  const isLocal = process.env.NODE_ENV === "development";
  const cookieOpts = {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    ...(!isLocal && { domain: ".portal659.com.ar" }),
  };
  // NOTA: no agregar segundo set() con el mismo nombre (ResponseCookies pisa
  // por nombre y rompería la sesión; ver login/route.ts).
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);
  return response;
}, { maxRequests: 15 });