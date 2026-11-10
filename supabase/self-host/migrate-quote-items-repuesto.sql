-- ============================================================================
-- Taller: presupuesto con partidas de repuesto (catálogo) + cuenta a cobrar.
-- ----------------------------------------------------------------------------
-- Columnas:
--   quote_items.product_id / variant_id  → repuesto del catálogo (stock).
--   quote_items.kind amplía su CHECK a 'repuesto' | 'material' | 'labor'.
--   quotes.status amplía su CHECK con 'cobrado'.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-quote-items-repuesto.sql
-- ============================================================================
ALTER TABLE public.quote_items
  DROP CONSTRAINT IF EXISTS quote_items_kind_check;
ALTER TABLE public.quote_items
  ADD CONSTRAINT quote_items_kind_check
  CHECK (kind IN ('repuesto', 'material', 'labor'));

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_id uuid;

CREATE INDEX IF NOT EXISTS idx_quote_items_product ON public.quote_items(product_id);

ALTER TABLE public.quotes
  DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_status_check
  CHECK (status IN ('pending', 'responded', 'accepted', 'cobrado', 'cancelled'));