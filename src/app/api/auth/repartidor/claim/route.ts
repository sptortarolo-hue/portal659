import { NextResponse } from "next/server";
import { query, queryOne, withTransaction } from "@/lib/db";
import { hashPassword, signAccessToken } from "@/lib/auth";

function normalizePhone(input: string): string {
  return (input || "").replace(/\D/g, "").trim();
}

/**
 * Claim del repartidor: teléfono + código (token) + contraseña elegida.
 * Crea/vincula el profile (identidad = teléfono) y consume el código.
 * El código es de USO ÚNICO: al consumirse se limpia; para recuperar acceso el
 * comercio regenera el código.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const code = String(body.code ?? "").trim().toUpperCase();
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");

  if (!code) return NextResponse.json({ error: "Falta el código" }, { status: 400 });
  if (!phone || phone.length < 8) return NextResponse.json({ error: "Teléfono inválido" }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "La contraseña debe tener al menos 6 caracteres" }, { status: 400 });

  const invite = await queryOne<{
    id: string;
    vendor_id: string;
    status: string;
    phone: string | null;
  }>(
    `SELECT id, vendor_id, status, phone FROM vendor_staff WHERE invite_code = $1 LIMIT 1`,
    [code]
  );

  if (!invite) return NextResponse.json({ error: "Código inválido o vencido" }, { status: 404 });
  if (invite.status === "revoked") return NextResponse.json({ error: "Este código ya no está activo" }, { status: 403 });

  const vendor = await queryOne<{ id: string; store_name: string }>(
    `SELECT id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [invite.vendor_id]
  );

  const passwordHash = await hashPassword(password);
  const email = `rep_${phone}@portal659.local`;

  const result = await withTransaction(async (tx) => {
    // Identity por teléfono: buscamos/creamos el perfil por email sintético.
    const existing = await tx.queryOne<{ id: string; token_version: number }>(
      `SELECT id, token_version FROM profiles WHERE email = $1 LIMIT 1`,
      [email]
    );

    let profileId: string;
    let tokenVersion = 1;
    if (existing) {
      await tx.queryVoid(`UPDATE profiles SET password_hash = $1, phone = $2, email_confirmed = true WHERE id = $3`, [passwordHash, phone, existing.id]);
      profileId = existing.id;
      tokenVersion = existing.token_version;
    } else {
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO profiles (email, password_hash, full_name, phone, role, email_confirmed)
         VALUES ($1, $2, $3, $4, 'buyer', true)
         RETURNING id`,
        [email, passwordHash, phone, phone]
      );
      profileId = rows[0].id;
    }

    // Vínculo: puede que el profile ya tuviera otra fila vendor_staff (multi);
    // para esta ronda resolvemos 1 comercio activo: lo marcamos activo acá.
    await tx.queryVoid(
      `UPDATE vendor_staff SET profile_id = $1, phone = $2, status = 'active', invite_code = NULL WHERE id = $3`,
      [profileId, phone, invite.id]
    );

    return { profileId, tokenVersion };
  });

  const accessToken = await signAccessToken({
    id: result.profileId,
    email,
    role: "buyer",
    tokenVersion: result.tokenVersion,
  });

  const response = NextResponse.json({ ok: true, vendor: { id: vendor?.id, store_name: vendor?.store_name } });
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
}