import { queryOne } from "@/lib/db";
import { isPreviewTokenValid } from "@/lib/preview";

/**
 * Flag de prueba (modo preview) para turnos, consultas y pedidos online.
 * Todo tolerante a migración sin aplicar: sin columna/tabla, siempre false.
 */

/** ¿El previewToken del body corresponde al comercio? (links ?preview=...). */
export async function isPreviewTokenForVendor(
  vendorId: string,
  token: unknown
): Promise<boolean> {
  if (!vendorId || typeof token !== "string" || !token) return false;
  try {
    const v = await queryOne<{
      preview_token: string | null;
      preview_token_expires_at: string | null;
    }>(
      `SELECT preview_token, preview_token_expires_at FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    ).catch(() => null);
    if (!v) return false;
    return isPreviewTokenValid(
      {
        preview_token: v.preview_token,
        preview_token_expires_at: v.preview_token_expires_at,
      },
      token
    );
  } catch {
    return false;
  }
}

/** ¿La fila (turno/consulta/pedido) es de prueba? Sin columna → false. */
export async function isPreviewRow(
  table: "bookings" | "quotes" | "orders",
  id: string
): Promise<boolean> {
  if (!id) return false;
  try {
    const r = await queryOne<{ is_preview: boolean | null }>(
      `SELECT is_preview FROM ${table} WHERE id = $1 LIMIT 1`,
      [id]
    ).catch(() => null);
    return r?.is_preview === true;
  } catch {
    return false;
  }
}
