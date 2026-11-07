import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPending2faToken, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { decryptTotpSecret, verifyTotp, isMissing2faMigration } from "@/lib/totp";

export const POST = withRateLimit(async (request: Request) => {
  const { pendingToken, code } = (await request.json().catch(() => ({}))) as {
    pendingToken?: string;
    code?: string;
  };
  if (!pendingToken || !code) {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }

  const decoded = await verifyPending2faToken(String(pendingToken));
  if (!decoded?.userId) {
    return NextResponse.json({ error: "La sesión pendiente expiró. Iniciá de nuevo." }, { status: 401 });
  }

  let user: {
    id: string;
    email: string;
    full_name: string | undefined;
    role: string;
    token_version: number;
    totp_secret: string | undefined;
    totp_enabled: boolean;
    totp_last_step: number | undefined;
  } | undefined;
  try {
    user = await queryOne<{
      id: string;
      email: string;
      full_name: string | undefined;
      role: string;
      token_version: number;
      totp_secret: string | undefined;
      totp_enabled: boolean;
      totp_last_step: number | undefined;
    }>(
      `SELECT id, email, full_name, role, token_version,
              totp_secret, COALESCE(totp_enabled, false) AS totp_enabled, totp_last_step
       FROM profiles WHERE id = $1`,
      [decoded.userId]
    );
  } catch (e) {
    if (isMissing2faMigration(e)) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-2fa-totp.sql en el contenedor de la DB." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Error al leer el perfil" }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "Usuario no encontrado." }, { status: 401 });
  }
  if ((decoded.tokenVersion ?? 1) !== user.token_version) {
    return NextResponse.json({ error: "La sesión pendiente expiró. Iniciá de nuevo." }, { status: 401 });
  }
  if (!user.totp_enabled || !user.totp_secret) {
    return NextResponse.json({ error: "La verificación en dos pasos no está activada." }, { status: 400 });
  }
  const secret = decryptTotpSecret(user.totp_secret);
  if (!secret) {
    return NextResponse.json({ error: "Secreto inválido." }, { status: 400 });
  }
  const v = verifyTotp(secret, String(code), user.totp_last_step);
  if (!v.ok) {
    return NextResponse.json({ error: "Código inválido o vencido. Probá el actual." }, { status: 401 });
  }
  // Anti-replay: persistir el paso verificado.
  try {
    await queryOne(
      `UPDATE profiles SET totp_last_step = $1 WHERE id = $2 RETURNING id`,
      [v.step, user.id]
    );
  } catch {
    /* best-effort: no bloquear el login si falla la persistencia */
  }

  const accessToken = await signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.token_version,
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
  const response = NextResponse.json({
    ok: true,
    session: { access_token: accessToken, refresh_token: accessToken },
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name || user.email,
      role: user.role,
    },
  });
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);
  return response;
}, { maxRequests: 10 });
