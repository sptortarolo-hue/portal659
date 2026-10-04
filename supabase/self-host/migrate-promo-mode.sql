-- Modo de imagen promo: compuesta (productos) o manual (foto subida).
-- Autocontenida e idempotente: incluye las columnas de
-- migrate-promo-share.sql y migrate-promo-selection.sql por si no se
-- aplicaron, y refresca updated_at para invalidar el caché (?v=) existente.

ALTER TABLE vendor_promo_images
  ADD COLUMN IF NOT EXISTS product_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE vendor_promo_images
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE vendor_promo_images
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'auto';

-- Las tarjetas cacheadas con la URL anterior quedan invalidadas.
UPDATE vendor_promo_images SET updated_at = now();
