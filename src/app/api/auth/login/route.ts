import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken, signRefreshToken, signPending2faToken, setAuthSessionCookies } from "@/lib/auth";
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
      is_admin: boolean;
      totp_enabled: boolean;
    }>(
      `SELECT id, email, full_name, role, password_hash, email_confirmed, token_version, is_admin, COALESCE(totp_enabled, false) AS totp_enabled FROM profiles WHERE lower(email) = lower($1)`,
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
        is_admin: boolean;
        totp_enabled: boolean;
      }>(
        `SELECT id, email, full_name, role, password_hash, email_confirmed, token_version, is_admin, COALESCE(totp_enabled, false) AS totp_enabled FROM profiles
         WHERE regexp_replace(whatsapp, '[^0-9]', '', 'g') = ANY($1)
            OR regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1)
         LIMIT 1`,
        [variants]
      );
    }
  }

  if (!user || !user.password_hash) {
    // Cuenta creada solo con Google (password_hash vacío): en vez de un
    // "credenciales inválidas" que no explica nada, se le indica el botón.
    if (user && !user.password_hash && (await usesGoogleLogin(user.id))) {
      return NextResponse.json(
        {
          error: "google_account",
          message: 'Esta cuenta usa Google. Entrá con "Continuar con Google".',
        },
        { status: 401 }
      );
    }
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

  // 2FA (TOTP): los admins con segundo factor activado reciben un desafío
  // en vez de una sesión. El token pendiente se canjea en
  // /api/auth/2fa/verify-login tras verificar el código TOTP.
  if (user.is_admin && user.totp_enabled) {
    const pendingToken = await signPending2faToken({
      id: user.id,
      tokenVersion: user.token_version,
    });
    return NextResponse.json({ need2fa: true, pendingToken });
  }

  const accessToken = await signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.token_version,
  });
  const refreshToken = await signRefreshToken({
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: user.token_version,
  });

  const response = NextResponse.json({
    ok: true,
    session: { access_token: accessToken, refresh_token: refreshToken },
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name || user.email,
      role: user.role,
    },
  });

  // Access (7d) + refresh (30d): el panel renueva solo con /api/auth/refresh.
  setAuthSessionCookies(response, accessToken, refreshToken);

  return response;
}, { maxRequests: 15 });

/**
 * ¿La cuenta está vinculada a Google? Se consulta solo cuando el perfil no
 * tiene contraseña, para devolver un mensaje útil en vez de "credenciales
 * inválidas". Tolerante a migración pendiente: sin la columna `google_sub`
 * devuelve false y el login sigue igual.
 */
async function usesGoogleLogin(userId: string): Promise<boolean> {
  try {
    const column = await queryOne<{ e: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'google_sub'
       ) AS e`
    );
    if (column?.e !== true) return false;
    const row = await queryOne<{ google_sub: string | null }>(
      `SELECT google_sub FROM profiles WHERE id = $1`,
      [userId]
    );
    return Boolean(row?.google_sub);
  } catch {
    return false;
  }
}