import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "crypto";
import { verifyAccessToken } from "./auth";
import { queryOne } from "./db";

/**
 * Modo prueba / preview compartible de micrositios.
 *
 * Un comercio oculto (`visible = false`) puede verse sin aparecer en
 * home/buscar/mapa/sitemap cuando:
 * - el visitante es el dueño (`vendors.user_id`), o
 * - es admin (`profiles.is_admin`), o
 * - presenta un `preview_token` válido (link compartible, con expiración opcional).
 */

export type PreviewActor = { userId: string; isAdmin: boolean } | null;

export type PreviewVendor = {
  id: string;
  user_id: string | null;
  visible: boolean | null;
  preview_token: string | null;
  preview_token_expires_at: string | null;
};

/** Actor autenticado desde las cookies (server components / route handlers). */
export async function getPreviewActor(): Promise<PreviewActor> {
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null;
  }
  // Puede haber varias cookies sb-access-token conviviendo (host-only legacy
  // + con Domain): se prueban todas hasta encontrar una válida.
  const candidates = store
    .getAll("sb-access-token")
    .map((c) => c.value)
    .filter(Boolean);
  for (const token of candidates) {
    const decoded = await verifyAccessToken(token);
    if (!decoded?.userId) continue;
    const profile = await queryOne<{ id: string; is_admin: boolean }>(
      `SELECT id, is_admin FROM profiles WHERE id = $1`,
      [decoded.userId]
    );
    if (profile) return { userId: profile.id, isAdmin: !!profile.is_admin };
  }
  return null;
}

/** Token válido y no expirado. */
export function isPreviewTokenValid(
  vendor: Pick<PreviewVendor, "preview_token" | "preview_token_expires_at">,
  token: string | null | undefined
): boolean {
  if (!token || !vendor.preview_token) return false;
  if (
    vendor.preview_token_expires_at &&
    new Date(vendor.preview_token_expires_at).getTime() < Date.now()
  ) {
    return false;
  }
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(vendor.preview_token);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * ¿Puede este visitante ver el comercio en modo prueba?
 * - Si ya es visible, siempre (no es preview, es público).
 * - Si está oculto: dueño, admin o token válido.
 */
export function canPreviewVendor(opts: {
  vendor: PreviewVendor;
  actor: PreviewActor;
  tokenParam: string | null;
}): boolean {
  const { vendor, actor, tokenParam } = opts;
  if (vendor.visible) return true;
  if (actor?.isAdmin) return true;
  if (actor && vendor.user_id && actor.userId === vendor.user_id) return true;
  if (tokenParam && isPreviewTokenValid(vendor, tokenParam)) return true;
  return false;
}

/** ¿Se está sirviendo en modo prueba? (oculto + acceso por preview). */
export function isServingPreview(vendor: PreviewVendor): boolean {
  return !vendor.visible;
}

/** Token nuevo para compartir (48 chars hex). */
export function generatePreviewToken(): string {
  return randomBytes(24).toString("hex");
}
