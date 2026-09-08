import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";
import { toE164Plus, toE164 } from "@/lib/phone";

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
    }>(
      `SELECT id, email, full_name, role, password_hash, email_confirmed FROM profiles WHERE lower(email) = lower($1)`,
      [identifier]
    );
  } else {
    // WhatsApp: normalizamos ambos formatos (con/sin +) para matchear contra la base.
    const plus = toE164Plus(identifier);
    const plain = toE164(identifier);
    const candidates = [plus, plain].filter(Boolean);
    if (candidates.length) {
      user = await queryOne<{
        id: string;
        email: string;
        full_name: string | null;
        role: string;
        password_hash: string;
        email_confirmed: boolean;
      }>(
        `SELECT id, email, full_name, role, password_hash, email_confirmed FROM profiles
         WHERE whatsapp = ANY($1) OR phone = ANY($1) LIMIT 1`,
        [candidates]
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
  };
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);

  return response;
}, { maxRequests: 15 });