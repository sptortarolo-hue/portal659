import { NextResponse } from "next/server";
import { hasTable, queryOne, withTransaction, type Tx } from "@/lib/db";
import {
  setAuthSessionCookies,
  signAccessToken,
  signPending2faToken,
  signRefreshToken,
} from "@/lib/auth";
import { getSiteUrl } from "@/lib/site-url";
import {
  GOOGLE_STATE_COOKIE,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getGoogleRedirectUri,
  googleStateCookieOpts,
  hasGoogleSubColumn,
  isGoogleAuthEnabled,
  verifyGoogleIdToken,
  verifyOAuthState,
} from "@/lib/google-auth";

// Siempre dinámico: depende del code/state de cada request.
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback?code=...&state=...
 *
 * Vuelta del consentimiento de Google. Emite la MISMA sesión JWT del portal
 * (cookies sb-access-token / sb-refresh-token) tras verificar la identidad.
 *
 * Reglas de cuenta:
 *  - google_sub ya vinculado → entra a ese perfil.
 *  - email existente sin vincular → se vincula (Google ya verificó el email).
 *    Si el perfil estaba SIN confirmar, se confirma y se borra la contraseña
 *    (así quien haya registrado ese email sin confirmarlo no puede entrar).
 *  - email vinculado a OTRA cuenta de Google → error, no se toca nada.
 *  - email nuevo → se crea un perfil comprador (password_hash vacío).
 *  - Admin con 2FA → no se crea sesión: se redirige a /login?pending=...
 *    y el login pide el código TOTP (mismo mecanismo que la contraseña).
 */

type GoogleProfileRow = {
  id: string;
  email: string;
  role: string;
  token_version: number;
  is_admin: boolean;
  totp_enabled: boolean;
  google_sub: string | null;
  email_confirmed: boolean | null;
  full_name: string | null;
};

const PROFILE_COLUMNS = `id, email, role, token_version, is_admin,
  COALESCE(totp_enabled, false) AS totp_enabled,
  google_sub,
  email_confirmed,
  full_name`;

/**
 * ¿El perfil es parte del equipo de un local (empleado/encargado/repartidor)?
 * Esas cuentas entran SIEMPRE con su login propio (usuario+contraseña o
 * teléfono+contraseña) y no se vinculan a Google. En la práctica ya quedan
 * fuera solas (email sintético @staff.portal659.local / @portal659.local),
 * pero el guard explícito cubre filas legacy con email real.
 */
async function isTeamProfile(tx: Tx, profileId: string): Promise<boolean> {
  if (!(await hasTable(tx, "vendor_staff"))) return false;
  const row = await tx.queryOne<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM vendor_staff WHERE profile_id = $1) AS ok`,
    [profileId]
  );
  return row?.ok === true;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export async function GET(request: Request) {
  const origin = getSiteUrl(request);
  const url = new URL(request.url);

  /** Redirige al login limpiando la cookie de state (siempre, en éxito o error). */
  const finish = (response: NextResponse): NextResponse => {
    response.cookies.set(GOOGLE_STATE_COOKIE, "", googleStateCookieOpts(0));
    return response;
  };
  const fail = (code: string): NextResponse =>
    finish(NextResponse.redirect(`${origin}/login?error=${code}`));

  // El usuario canceló / Google devolvió un error.
  if (url.searchParams.get("error")) return fail("google_cancelled");
  if (!isGoogleAuthEnabled()) return fail("google_disabled");

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const cookieState = readCookie(request, GOOGLE_STATE_COOKIE);

  // Doble submit: el state debe coincidir con el que dejamos en ESTE navegador.
  if (!code || !state || !cookieState || state !== cookieState) {
    return fail("google_state");
  }
  const verifiedState = verifyOAuthState(state);
  if (!verifiedState) return fail("google_state");

  if (!(await hasGoogleSubColumn())) return fail("google_migration");

  const tokens = await exchangeGoogleCode(code, getGoogleRedirectUri(request));
  if (!tokens.ok) {
    console.error("[google-auth] no se pudo canjear el código:", tokens.error);
    return fail("google_exchange");
  }

  const identity = tokens.idToken
    ? await verifyGoogleIdToken(tokens.idToken)
    : await fetchGoogleUserInfo(tokens.accessToken);
  if (!identity) return fail("google_token");

  // ============================================================
  // Resolver el perfil (vincular / crear) en una transacción.
  // ============================================================
  let profile: GoogleProfileRow | null = null;
  let conflict = false;
  let staffBlocked = false;

  try {
    const result = await withTransaction(async (tx) => {
      // 1) Ya vinculado a esta cuenta de Google.
      const bySub = await tx.queryOne<GoogleProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE google_sub = $1 LIMIT 1`,
        [identity.sub]
      );
      if (bySub) {
        if (await isTeamProfile(tx, bySub.id)) return { kind: "staff" as const };
        return { kind: "ok" as const, profile: bySub };
      }

      // 2) Mismo email: vincular (Google ya verificó que el email es suyo).
      const byEmail = await tx.queryOne<GoogleProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM profiles WHERE lower(email) = lower($1) LIMIT 1 FOR UPDATE`,
        [identity.email]
      );

      if (byEmail) {
        if (await isTeamProfile(tx, byEmail.id)) return { kind: "staff" as const };
        if (byEmail.google_sub && byEmail.google_sub !== identity.sub) {
          return { kind: "conflict" as const };
        }
        const linked = await tx.queryOne<GoogleProfileRow>(
          `UPDATE profiles
              SET google_sub = $2,
                  email_confirmed = true,
                  verified = true,
                  password_hash = CASE WHEN $3 THEN '' ELSE password_hash END,
                  updated_at = now()
            WHERE id = $1
            RETURNING ${PROFILE_COLUMNS}`,
          [byEmail.id, identity.sub, byEmail.email_confirmed === false]
        );
        if (!linked) throw new Error("No se pudo vincular la cuenta");
        return { kind: "ok" as const, profile: linked };
      }

      // 3) Cuenta nueva: comprador (el alta de comercio sigue por /register).
      const created = await tx.queryOne<GoogleProfileRow>(
        `INSERT INTO profiles (email, password_hash, full_name, role, email_confirmed, verified, google_sub)
         VALUES ($1, '', $2, 'buyer', true, true, $3)
         RETURNING ${PROFILE_COLUMNS}`,
        [identity.email, identity.name || null, identity.sub]
      );
      if (!created) throw new Error("No se pudo crear la cuenta");
      return { kind: "ok" as const, profile: created };
    });

    if (result.kind === "staff") staffBlocked = true;
    else if (result.kind === "conflict") conflict = true;
    else profile = result.profile;
  } catch (e) {
    // Carrera: dos callbacks simultáneos con el mismo email → unique violation.
    // Se relee una vez (la fila ya quedó creada/vinculada por el otro).
    const pgCode = (e as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      // Solo se acepta la fila si es de ESTA cuenta de Google (o si quedó sin
      // vincular por una carrera): nunca se entra a un perfil vinculado a otro
      // `sub` aunque el email coincida.
      const existing = await queryOne<GoogleProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM profiles
          WHERE google_sub = $1
             OR (lower(email) = lower($2) AND google_sub IS NULL)
          LIMIT 1`,
        [identity.sub, identity.email]
      );
      if (existing) profile = existing;
    } else {
      console.error("[google-auth] no se pudo resolver la cuenta:", e);
    }
  }

  if (staffBlocked) return fail("google_staff");
  if (conflict) return fail("google_conflict");
  if (!profile) return fail("google_error");

  // Admin con 2FA: el ingreso con Google también pide el código TOTP.
  if (profile.is_admin && profile.totp_enabled) {
    const pendingToken = await signPending2faToken({
      id: profile.id,
      tokenVersion: profile.token_version,
    });
    const dest = new URL(`${origin}/login`);
    dest.searchParams.set("pending", pendingToken);
    if (verifiedState.next) dest.searchParams.set("next", verifiedState.next);
    return finish(NextResponse.redirect(dest));
  }

  const claims = {
    id: profile.id,
    email: profile.email,
    role: profile.role,
    tokenVersion: profile.token_version,
  };
  const accessToken = await signAccessToken(claims);
  const refreshToken = await signRefreshToken(claims);

  const target =
    verifiedState.next || (profile.role === "vendor" ? "/vendor/dashboard" : "/");
  const response = NextResponse.redirect(`${origin}${target}`);
  setAuthSessionCookies(response, accessToken, refreshToken);
  return finish(response);
}
