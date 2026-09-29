-- Códigos de barra por producto (mostrador: búsqueda/escaneo; etiquetas).
-- variants.sku ya existe (moda). UNIQUE parcial: códigos únicos por comercio.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-barcodes.sql

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_vendor_sku
  ON public.products (vendor_id, sku) WHERE sku IS NOT NULL AND sku <> '';
