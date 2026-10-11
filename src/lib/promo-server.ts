import { query } from "./db";

/**
 * Mueve el versionado de la tarjeta promo (?v=) cuando cambia el catálogo.
 * La imagen OG se cachea por URL 24hs en el edge + días en WhatsApp: sin
 * este toque, editar precios/promos no se reflejaba nunca.
 * Best-effort y tolerante a migraciones sin aplicar: nunca rompe el request.
 */
export async function touchPromoVersion(vendorId: string): Promise<void> {
  try {
    try {
      await query(
        `INSERT INTO vendor_promo_images (vendor_id, image_url, product_ids, updated_at, mode)
         VALUES ($1, '', '[]'::jsonb, now(), 'auto')
         ON CONFLICT (vendor_id) DO UPDATE SET updated_at = now()`,
        [vendorId]
      );
    } catch {
      try {
        await query(
          `INSERT INTO vendor_promo_images (vendor_id, image_url, product_ids, updated_at)
           VALUES ($1, '', '[]'::jsonb, now())
           ON CONFLICT (vendor_id) DO UPDATE SET updated_at = now()`,
          [vendorId]
        );
      } catch {
        await query(
          `INSERT INTO vendor_promo_images (vendor_id, image_url)
           VALUES ($1, '')
           ON CONFLICT (vendor_id) DO NOTHING`,
          [vendorId]
        );
      }
    }
  } catch {
    /* best-effort */
  }
}
