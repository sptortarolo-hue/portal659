import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getSiteUrl } from "./site-url";
import { queryOne } from "./db";

/**
 * Login con Google (OAuth 2.0 / OpenID Connect).
 *
 * Flujo Authorization Code server-side:
 *   1. GET /api/auth/google        → state firmado (HMAC) + cookie anti-CSRF
 *                                    + redirect a accounts.google.com
 *   2. GET /api/auth/google/callback → valida state/cookie, canjea el code,
 *                                    verifica el id_token (JWKS de Google)
 *                                    y emite la MISMA sesión JWT del portal.
 *
 * No agrega dependencias: `jose` (ya instalado) verifica la firma del
 * id_token contra las claves públicas de Google.
 *
 * Qué cuentas usan Google:
 *  - Comprador / cliente (cuenta personal).
 *  - Dueño de comercio: es la misma cuenta personal con role='vendor'.
 *  - Admin (con 2FA sigue pidiendo el código TOTP).
 * NO lo usan el equipo del local (usuario + contraseña, email sintético
 * @staff.portal659.local) ni los repartidores (login propio por teléfono).
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// El state del OAuth expira en 10 minutos (anti-replay / anti-CSRF).
const STATE_TTL_MS = 10 * 60 * 1000;

/** Cookie donde viaja el state (doble submit: protege el login-CSRF). */
export const GOOGLE_STATE_COOKIE = "portal659-google-state";

/**
 * Llave maestra + credenciales. Sin GOOGLE_CLIENT_ID/SECRET el botón no
 * aparece y las rutas redirigen con `?error=google_disabled`.
 * `GOOGLE_AUTH_ENABLED=0` permite apagarlo sin borrar las credenciales.
 */
export function isGoogleAuthEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_AUTH_ENABLED !== "0"
  );
}

/**
 * Redirect URI EXACTA que hay que registrar en Google Cloud Console.
 * Se puede fijar por env (útil si el dominio público difiere del de la app);
 * por defecto se deriva del sitio (prod: https://www.portal659.com.ar).
 */
export function getGoogleRedirectUri(request?: Request): string {
  const explicit = (process.env.GOOGLE_REDIRECT_URI || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  return `${getSiteUrl(request)}/api/auth/google/callback`;
}

/**
 * Solo rutas internas: evita open redirects (`//evil.com`, `https://...`).
 * Se acepta cualquier path que empiece con "/" y no sea "//" ni contenga "\".
 */
export function safeNextPath(next: string | null | undefined): string | undefined {
  const value = (next || "").trim();
  if (!value || value.length > 300) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  if (value.includes("\\")) return undefined;
  return value;
}

// ============================================================
// State firmado (HMAC con JWT_SECRET)
// ============================================================

type OAuthStatePayload = { next?: string; nonce: string; ts: number };

function stateHmac(payload: string): string {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET no está configurado");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signOAuthState(next?: string | null): string {
  const payload: OAuthStatePayload = { nonce: randomUUID(), ts: Date.now() };
  const nextPath = safeNextPath(next);
  if (nextPath) payload.next = nextPath;
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${stateHmac(encoded)}`;
}

export function verifyOAuthState(state: string): { next?: string } | null {
  const [encoded, sig] = state.split(".");
  if (!encoded || !sig) return null;

  const expected = stateHmac(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8")
    ) as OAuthStatePayload;
    if (!parsed || typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > STATE_TTL_MS) return null;
    return { next: safeNextPath(parsed.next) };
  } catch {
    return null;
  }
}

/** Opciones de la cookie de state (mismo criterio que las de sesión). */
export function googleStateCookieOpts(maxAgeSeconds = STATE_TTL_MS / 1000) {
  const isLocal = process.env.NODE_ENV === "development";
  return {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/api/auth/google",
    maxAge: maxAgeSeconds,
    ...(!isLocal && { domain: ".portal659.com.ar" }),
  };
}

// ============================================================
// URLs / llamadas a Google
// ============================================================

export function buildGoogleAuthUrl({
  state,
  redirectUri,
}: {
  state: string;
  redirectUri: string;
}): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // Siempre deja elegir cuenta: en una compu compartida (mostrador) evita
    // entrar con la sesión de Google de otra persona sin darse cuenta.
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleTokens = {
  ok: boolean;
  error?: string;
  idToken?: string;
  accessToken?: string;
};

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirect_uri: redirectUri,
  });

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      id_token?: string;
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || data.error) {
      return {
        ok: false,
        error: data.error || data.error_description || `http_${res.status}`,
      };
    }
    return { ok: true, idToken: data.id_token, accessToken: data.access_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network" };
  }
}

// ============================================================
// Identidad de Google (id_token)
// ============================================================

export type GoogleIdentity = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

// Cache de claves públicas de Google (jose las refresca solo).
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Verifica el id_token de Google: firma (JWKS), emisor, audiencia (nuestro
 * client_id) y que el email esté verificado. Devuelve null ante cualquier
 * anomalía (nunca se confía en datos sin verificar).
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  if (!clientId || !idToken) return null;

  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
    });

    const sub = typeof payload.sub === "string" ? payload.sub : "";
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const emailVerified =
      payload.email_verified === true || payload.email_verified === "true";

    if (!sub || !email || !emailVerified) return null;

    return {
      sub,
      email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fallback: si Google no devolvió id_token (no debería con scope openid),
 * se pide el userinfo con el access token. Mismas validaciones.
 */
export async function fetchGoogleUserInfo(
  accessToken?: string
): Promise<GoogleIdentity | null> {
  if (!accessToken) return null;
  try {
    const res = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      sub?: string;
      email?: string;
      email_verified?: boolean | string;
      name?: string;
      picture?: string;
    } | null;
    if (!data) return null;

    const sub = typeof data.sub === "string" ? data.sub : "";
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    const emailVerified = data.email_verified === true || data.email_verified === "true";
    if (!sub || !email || !emailVerified) return null;

    return { sub, email, name: data.name, picture: data.picture };
  } catch {
    return null;
  }
}

/**
 * ¿Está aplicada migrate-google-auth.sql? El callback responde 503 nombrando
 * el archivo si falta (patrón del repo: nunca romper con un 500 opaco).
 * No se cachea: information_schema es barato y así el deploy no necesita
 * reiniciar el contenedor para detectar la migración recién aplicada.
 */
export async function hasGoogleSubColumn(): Promise<boolean> {
  try {
    const row = await queryOne<{ e: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'google_sub'
       ) AS e`
    );
    return row?.e === true;
  } catch {
    return false;
  }
}
