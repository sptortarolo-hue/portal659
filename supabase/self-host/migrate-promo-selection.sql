-- Selección de productos para la imagen promo compuesta.
-- vendor_promo_images.product_ids: ids de productos (máx 3) que componen la
-- tarjeta OG de /promo. Vacío = automático (top 3 por % off).
-- updated_at: versiona la tarjeta (?v=) para refrescar caché de Cloudflare/WhatsApp.

ALTER TABLE vendor_promo_images
  ADD COLUMN IF NOT EXISTS product_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE vendor_promo_images
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
