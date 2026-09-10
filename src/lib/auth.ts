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
export function extractAllTokens(request: Request): string[] {
  const out: string[] = [];
  const auth = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (auth) out.push(auth);
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieTokens: string[] = [];
  for (const m of cookieHeader.matchAll(/sb-access-token=([^;]*)/g)) {
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
  let decoded: { userId: string; email?: string; role?: string } | null = null;
  for (const token of extractAllTokens(request)) {
    const d = await verifyAccessToken(token);
    if (d?.userId) {
      decoded = d;
      break;
    }
  }
  if (!decoded) return null;

  const user = await queryOne<{ id: string; email: string; full_name: string | null; role: string; verified: boolean; is_admin: boolean }>(
    `SELECT id, email, full_name, role, verified, is_admin FROM profiles WHERE id = $1`,
    [decoded.userId]
  );
  if (!user) return null;

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