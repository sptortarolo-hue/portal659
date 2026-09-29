-- Vista del catálogo online por comercio ("Vidriera" para regalería/juguetería).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-storefront-layout.sql

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS storefront_layout text NOT NULL DEFAULT 'lista'
  CHECK (storefront_layout IN ('lista', 'vidriera'));
