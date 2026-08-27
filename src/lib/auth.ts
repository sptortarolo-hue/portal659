import { SignJWT, jwtVerify } from "jose";
import * as argon2 from "argon2";
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

/** Firma un JWT (access token). */
export async function signAccessToken(user: {
  id: string;
  email: string;
  role: string;
}): Promise<string> {
  return new SignJWT({ sub: user.id, email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(getJwtSecret());
}

/** Verifica y decodifica un access token. Devuelve null si es inválido/expirado. */
export async function verifyAccessToken(
  token: string
): Promise<{ userId: string; email?: string; role?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      userId: (payload.sub as string) || "",
      email: (payload.email as string) || undefined,
      role: (payload.role as string) || undefined,
    };
  } catch {
    return null;
  }
}

/** Extrae el token del request (header Authorization o cookie). */
export function extractToken(request: Request): string | undefined {
  return (
    request.headers.get("authorization")?.replace("Bearer ", "") ||
    request.headers.get("cookie")?.match(/sb-access-token=([^;]+)/)?.[1]
  );
}

/**
 * Carga el usuario autenticado desde el token.
 * Devuelve null si no hay sesión válida.
 */
export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const token = extractToken(request);
  if (!token) return null;
  const decoded = await verifyAccessToken(token);
  if (!decoded?.userId) return null;

  const user = await queryOne<{ id: string; email: string; full_name: string | null; role: string; verified: boolean }>(
    `SELECT id, email, full_name, role, verified FROM profiles WHERE id = $1`,
    [decoded.userId]
  );
  if (!user) return null;

  const vendor = await queryOne<{ is_admin: boolean }>(
    `SELECT is_admin FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );

  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    verified: user.verified,
    is_admin: vendor?.is_admin === true,
  };
}

/** Helper de guard: carga el usuario o lanza/retorna null. */
export async function requireUser(request: Request): Promise<AuthUser | null> {
  return getAuthUser(request);
}