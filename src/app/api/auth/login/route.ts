import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { phoneVariantsAR } from "@/lib/phone";

export const POST = withRateLimit(async (request: Request) => {
  const { email, password } = await request.json();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Ingresá tu email o WhatsApp, y tu contraseña" },
      { status: 400 }
    );
  }

  const identifier = String(email).trim();
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

  let user = null;
  if (looksLikeEmail) {
    user = await queryOne<{
      id: string;
      email: string;
      full_name: string | null;
      role: string;
      password_hash: string;
      email_confirmed: boolean;
      token_version: number;
    }>(
      `SELECT id, email, full_name, role, password_hash, email_confirmed, token_version FROM profiles WHERE lower(email) = lower($1)`,
      [identifier]
    );
  } else {
    // WhatsApp: matcheamos por dígitos contra cualquier formato guardado
    // (E.164 con/sin "+", con/sin el 9 móvil, o nacional sin prefijos).
    const variants = phoneVariantsAR(identifier);
    if (variants.length > 0) {
      user = await queryOne<{
        id: string;
        email: string;
        full_name: string | null;
        role: string;
        password_hash: string;
        email_confirmed: boolean;
        token_version: number;
      }>(
        `SELECT id, email, full_name, role, password_hash, email_confirmed, token_version FROM profiles
         WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') = ANY($1)
            OR regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1)
         LIMIT 1`,
        [variants]
      );
    }
  }

  if (!user || !user.password_hash) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  if (user.email_confirmed === false) {
    return NextResponse.json(
      { error: "confirm_email", message: "Confirmá tu email para poder iniciar sesión." },
      { status: 403 }
    );
  }

  const accessToken = await signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.token_version,
  });

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

  const isLocal = process.env.NODE_ENV === "development";
  const cookieOpts = {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    ...(!isLocal && { domain: ".portal659.com.ar" }),
  };
  // NOTA: no agregar un segundo set() con el mismo nombre para limpiar la
  // variante host-only legacy: ResponseCookies usa un Map por nombre y el
  // segundo set PISARÍA la cookie válida (rompe el login). El shadowing se
  // resuelve del lado servidor en getAuthUser (prueba todos los candidatos).
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);

  return response;
}, { maxRequests: 15 });