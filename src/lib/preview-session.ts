import { SignJWT, jwtVerify } from "jose";
import { queryOne } from "./db";

/**
 * Sesión de prueba del panel: acceso temporal al dashboard de UN comercio
 * sin cuenta registrada, desde el link de preview compartible.
 *
 * Seguridad:
 * - JWT firmado con JWT_SECRET (no falsificable), TTL corto.
 * - Alcance: solo el vendor_id del token; jamás otorga is_admin
 *   (las rutas /api/admin/* exigen profiles.is_admin → 403).
 * - Revocación: al rotar/revocar vendors.preview_token la sesión muere.
 */

export const PREVIEW_DASHBOARD_COOKIE = "portal659-preview-dashboard";
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 h

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET no está configurado");
  return new TextEncoder().encode(secret);
}

export type PreviewSession = { vendorId: string };

/** Firma una sesión de prueba para un comercio. */
export async function signPreviewSession(vendorId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: vendorId, kind: "preview-dashboard" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(getJwtSecret());
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=").trim();
  }
  return null;
}

/**
 * Valida la sesión de prueba del request. Devuelve el vendorId si la sesión
 * es válida Y el comercio mantiene un preview_token vigente.
 */
export async function getPreviewSessionVendorId(
  request: Request
): Promise<string | null> {
  const token = getCookie(request, PREVIEW_DASHBOARD_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (payload.kind !== "preview-dashboard" || typeof payload.sub !== "string") {
      return null;
    }
    const vendor = await queryOne<{
      id: string;
      preview_token: string | null;
      preview_token_expires_at: string | null;
    }>(
      `SELECT id, preview_token, preview_token_expires_at FROM vendors WHERE id = $1 LIMIT 1`,
      [payload.sub]
    );
    if (!vendor || !vendor.preview_token) return null;
    if (
      vendor.preview_token_expires_at &&
      new Date(vendor.preview_token_expires_at).getTime() < Date.now()
    ) {
      return null;
    }
    return vendor.id;
  } catch {
    return null;
  }
}
