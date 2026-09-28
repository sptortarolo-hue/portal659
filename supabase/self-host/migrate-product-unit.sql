-- Unidad de venta por producto (mostrador con balanza): 'unidad' (default)
-- o 'kg' (precio = $/kg, se vende fraccionado). La columna ya existe en
-- schema.sql para instalaciones nuevas; esta migración la agrega si falta.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-unit.sql

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'unidad';
