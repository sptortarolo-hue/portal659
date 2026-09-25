-- Promo solo-promo (vidriera): producto que sale en la sección Promo sin
-- figurar en el menú. La sección Promo la arman los productos con promo_price;
-- promo_only=true los oculta de las secciones normales del menú.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-promo-only.sql

ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS products_vendor_promo_idx ON products (vendor_id) WHERE promo_only = true;
