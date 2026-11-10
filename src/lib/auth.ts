import { SignJWT, jwtVerify } from "jose";
import * as argon2 from "argon2";
import type { NextResponse } from "next/server";
import { queryOne } from "./db";

export type AuthUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  verified: boolean;
  is_admin: boolean;
};

const ACCESS_TTL = "7d";
const REFRESH_TTL = "30d";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET no está configurado");
  return new TextEncoder().encode(secret);
}

/** Hash de contraseña con argon2. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

/** Verifica una contraseña contra su hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

type DecodedToken = { userId: string; email?: string; role?: string; tv?: number; staff?: boolean };

export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 días (igual que ACCESS_TTL)
export const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 días (igual que REFRESH_TTL)

/** Opciones de cookie de sesión, compartidas por login/refresh/logout. */
export function authCookieOpts(maxAgeSeconds: number) {
  const isLocal = process.env.NODE_ENV === "development";
  return {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    ...(!isLocal && { domain: ".portal659.com.ar" }),
  };
}

/**
 * Setea ambas cookies de sesión en la respuesta: access (7d) + refresh (30d).
 * NOTA: un solo set() por nombre (ResponseCookies pisa por nombre; el shadowing
 * host-only legacy se resuelve del lado servidor en getAuthUser/refresh).
 */
export function setAuthSessionCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
) {
  response.cookies.set("sb-access-token", accessToken, authCookieOpts(ACCESS_COOKIE_MAX_AGE));
  response.cookies.set("sb-refresh-token", refreshToken, authCookieOpts(REFRESH_COOKIE_MAX_AGE));
}

/**
 * Firma un JWT (access token). `tv` = versión de tokens (logout en todos
 * lados). `staff: true` marca la sesión de equipo del local (empleado o
 * encargado, login "Soy del equipo"): el proxy la limita a su panel
 * (/vendor, /perfil y /manuales) — ver src/proxy.ts.
 */
// ============================================================
// 2FA (TOTP) para admins: token de sesión "pendiente".
// Al loguear un admin con 2FA activada se devuelve este token (5 min)
// en el body en vez de crear la sesión; el paso /api/auth/2fa/verify-login
// lo canjea por la sesión real tras verificar el código TOTP.
// ============================================================
export async function signPending2faToken(user: {
  id: string;
  tokenVersion?: number;
}): Promise<string> {
  return new SignJWT({ twofa: "pending", tv: user.tokenVersion ?? 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getJwtSecret());
}

export async function verifyPending2faToken(
  token: string
): Promise<{ userId: string; tokenVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.twofa !== "pending") return null;
    return {
      userId: (payload.sub as string) || "",
      tokenVersion: typeof payload.tv === "number" ? payload.tv : 1,
    };
  } catch {
    return null;
  }
}

export async function signAccessToken(user: {
  id: string;
  email: string;
  role: string;
  tokenVersion?: number;
  staff?: boolean;
}): Promise<string> {
  return signSessionToken(user, ACCESS_TTL);
}

/**
 * Refresh token: mismos claims, 30 días. Viaja en la cookie `sb-refresh-token`
 * y solo lo consume POST /api/auth/refresh (renueva el access de 7d). Así una
 * sesión puede vivir 30 días aunque el access vence a la semana — antes ambas
 * cookies guardaban el mismo token de 7d y al vencer el mostrador quedaba en
 * "No autenticado" sin salida.
 */
export async function signRefreshToken(user: {
  id: string;
  email: string;
  role: string;
  tokenVersion?: number;
  staff?: boolean;
}): Promise<string> {
  return signSessionToken(user, REFRESH_TTL);
}

function signSessionToken(
  user: { id: string; email: string; role: string; tokenVersion?: number; staff?: boolean },
  ttl: string
): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    tv: user.tokenVersion ?? 1,
    // Solo empleado/encargado: los tokens de dueño/comprador/repartidor no
    // llevan el claim (el proxy los trata como sesión normal).
    ...(user.staff ? { staff: true } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(getJwtSecret());
}

/** Verifica y decodifica un access token. Devuelve null si es inválido/expirado. */
export async function verifyAccessToken(
  token: string
): Promise<DecodedToken | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      userId: (payload.sub as string) || "",
      email: (payload.email as string) || undefined,
      role: (payload.role as string) || undefined,
      tv: typeof payload.tv === "number" ? payload.tv : undefined,
      staff: payload.staff === true,
    };
  } catch {
    return null;
  }
}

/** Extrae el token del request (header Authorization o cookie). */
export function extractToken(request: Request): string | undefined {
  return extractAllTokens(request)[0];
}

/**
 * Extrae TODOS los tokens candidatos del request.
 * El navegador puede enviar varias cookies `sb-access-token` a la vez
 * (ej. una host-only legacy sin `Domain` + la nueva con
 * `Domain=.portal659.com.ar`): son keys distintas y coexisten.
 * Se devuelven en orden (header primero) para que el llamador pruebe
 * cada uno hasta encontrar uno válido.
 */
export function extractAllTokens(
  request: Request,
  cookieName: "sb-access-token" | "sb-refresh-token" = "sb-access-token"
): string[] {
  const out: string[] = [];
  const auth = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (auth) out.push(auth);
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieTokens: string[] = [];
  for (const m of cookieHeader.matchAll(new RegExp(`${cookieName}=([^;]*)`, "g"))) {
    const t = (m[1] || "").trim();
    if (t) cookieTokens.push(t);
  }
  // Las cookies con mismo path llegan en orden de creación (la más vieja
  // primero): se prueban de la más nueva a la más vieja para preferir la
  // sesión vigente cuando conviven variantes (host-only legacy + con Domain).
  out.push(...cookieTokens.reverse());
  return out;
}

/**
 * Carga el usuario autenticado desde el token.
 * Devuelve null si no hay sesión válida.
 */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  // Probar cada candidato hasta encontrar uno que verifique (ver extractAllTokens:
  // puede haber una cookie host-only legacy conviviendo con la nueva con Domain).
  let decoded: DecodedToken | null = null;
  for (const token of extractAllTokens(request)) {
    const d = await verifyAccessToken(token);
    if (d?.userId) {
      decoded = d;
      break;
    }
  }
  if (!decoded) return null;

  const user = await queryOne<{ id: string; email: string; full_name: string | null; role: string; verified: boolean; is_admin: boolean; token_version: number }>(
    `SELECT id, email, full_name, role, verified, is_admin, token_version FROM profiles WHERE id = $1`,
    [decoded.userId]
  );
  if (!user) return null;
  // Token revocado (logout en todos los dispositivos): la versión del claim
  // debe coincidir con la actual del perfil. Tokens viejos (sin `tv`) valen 1.
  if ((decoded.tv ?? 1) !== user.token_version) return null;

  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    verified: user.verified,
    is_admin: user.is_admin === true,
  };
}

/** Helper de guard: carga el usuario o lanza/retorna null. */
export async function requireUser(request: Request): Promise<AuthUser | null> {
  return getAuthUser(request);
}