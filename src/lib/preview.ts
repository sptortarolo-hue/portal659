import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "crypto";
import { verifyAccessToken } from "./auth";
import { queryOne } from "./db";

/**
 * Modo prueba / preview compartible de micrositios.
 *
 * Estados de visibilidad (columna `visibility`):
 * - public:    visible en portal (home/buscar/mapa/sitemap), micrositio abierto
 * - private:   NO visible en portal, micrositio funcional SIN limitaciones de preview
 * - hidden:    oculto, solo accesible via preview token (dueño/admin/token)
 *
 * Lógica de acceso al micrositio:
 * - public:    siempre accesible
 * - private:   accesible para dueño/admin (sin token preview)
 * - hidden:    accesible solo con preview token válido (dueño/admin/token)
 */

export type PreviewActor = { userId: string; isAdmin: boolean } | null;

export type PreviewVendor = {
  id: string;
  user_id: string | null;
  visible: boolean | null;
  visibility: "hidden" | "private" | "public" | null;
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
 * ¿Puede este visitante ver el micrositio?
 * - public:    siempre
 * - private:   dueño o admin (sin token preview)
 * - hidden:    dueño, admin o token preview válido
 */
export function canPreviewVendor(opts: {
  vendor: PreviewVendor;
  actor: PreviewActor;
  tokenParam: string | null;
}): boolean {
  const { vendor, actor, tokenParam } = opts;
  const vis = vendor.visibility ?? (vendor.visible ? "public" : "hidden");

  if (vis === "public") return true;
  if (actor?.isAdmin) return true;
  if (actor && vendor.user_id && actor.userId === vendor.user_id) return true;

  // Solo hidden requiere token preview; private NO lo necesita para owner/admin
  if (vis === "hidden" && tokenParam && isPreviewTokenValid(vendor, tokenParam)) return true;

  return false;
}

/** ¿Se está sirviendo en modo preview (con limitaciones: is_preview, banner, etc.)? */
export function isServingPreview(vendor: PreviewVendor): boolean {
  const vis = vendor.visibility ?? (vendor.visible ? "public" : "hidden");
  return vis === "hidden";
}

/** Token nuevo para compartir (48 chars hex). */
export function generatePreviewToken(): string {
  return randomBytes(24).toString("hex");
}
