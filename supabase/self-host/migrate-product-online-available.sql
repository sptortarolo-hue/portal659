-- ============================================================================
-- Producto: venta online on/off (independiente de "disponible/pausar").
-- ----------------------------------------------------------------------------
-- Columna:
--   products.online_available (default true). Cuando es false, el producto se
--   oculta de la venta online (micrositio/checkout) pero sigue disponible en
--   mostrador y como repuesto en taller. Hoy solo se gestiona desde el panel
--   para el vertical taller.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-online-available.sql
-- ============================================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS online_available boolean NOT NULL DEFAULT true;