-- Presentaciones (familia de productos): un producto "raíz" con N presentaciones
-- hermanas (mismo producto, distinto envase). Cada presentación es un producto
-- real con su propio precio, stock, SKU, PLU y receta; la familia solo agrupa
-- para la visualización (micrositio, carta QR, mostrador).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-presentations.sql
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS presentation_label text;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS presentation_qty numeric(10, 3);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS presentation_unit text;

CREATE INDEX IF NOT EXISTS idx_products_parent
  ON public.products(parent_id) WHERE parent_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_no_self_parent' AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_no_self_parent
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;