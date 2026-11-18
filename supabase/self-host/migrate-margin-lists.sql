-- ============================================================
-- migrate-margin-lists.sql — Listas de margen (recargo/margen sobre costo)
-- Reejecutable (IF NOT EXISTS / DO $$ EXCEPTION WHEN duplicate).
-- Sin aplicar: el ABM de listas y el recálculo responden 503 nombrando este
-- archivo; las ops masivas por costo (bulk-price) ya toleran la ausencia de
-- las columnas cost_last (degradan a "sin costo").
-- ============================================================

CREATE TABLE IF NOT EXISTS public.margin_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- 'markup': precio = cost_last × (1 + pct/100) ("recargo sobre costo")
  -- 'margin': precio = cost_last / (1 - pct/100) ("margen sobre el precio", pct < 100)
  rule text NOT NULL DEFAULT 'markup',
  pct numeric(6,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT margin_lists_rule_check CHECK (rule IN ('markup', 'margin')),
  CONSTRAINT margin_lists_pct_check CHECK (
    pct >= 0 AND (rule = 'markup' OR pct < 100)
  )
);

-- Nombre único por comercio (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS margin_lists_vendor_name_key
  ON public.margin_lists (vendor_id, lower(name));

-- Productos: a lo sumo una lista por producto. ON DELETE SET NULL: borrar la
-- lista no borra ni altera los productos (quedan "sin lista").
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN margin_list_id uuid REFERENCES public.margin_lists(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS products_margin_list_idx ON public.products (margin_list_id) WHERE margin_list_id IS NOT NULL;

-- Comentarios de columna (para el panel y futuros dumps).
COMMENT ON COLUMN public.products.margin_list_id IS 'Lista de margen aplicada al producto (recargo/margen sobre cost_last). NULL = sin lista.';
