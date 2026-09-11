-- Receta compartida (porción + entera) + semáforo food-cost editable.
-- Un producto puede "colgarse" de la receta de otro con sus propios
-- `servings` (porciones que representa su venta): el COSTO se deriva
-- (total / rinde * servings) pero el PRECIO sigue siendo propio de cada
-- producto. Un producto tiene receta propia O link, nunca ambas
-- (se valida en API).
-- Umbrales del semáforo por comercio (global): NULL = defaults 30/35.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-recipe-links.sql

-- ============================================================
-- LINKS DE RECETA: otras presentaciones a la venta del mismo batch.
-- Ej.: receta "Torta" (rinde 6) + link ("Porción", servings=1) +
-- link ("Torta entera", servings=6).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_recipe_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  servings numeric(10, 3) NOT NULL DEFAULT 1 CHECK (servings > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_recipe_links_unique_product UNIQUE (product_id)
);
CREATE INDEX IF NOT EXISTS idx_prl_recipe ON public.product_recipe_links(recipe_id);
CREATE INDEX IF NOT EXISTS idx_prl_product ON public.product_recipe_links(product_id);

-- ============================================================
-- SEMÁFORO EDITABLE (global por comercio, NULL = defaults 30/35).
-- food_cost_warn: desde este % es amarillo. food_cost_bad: desde este % es rojo.
-- ============================================================
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS food_cost_warn numeric(5, 2);
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS food_cost_bad numeric(5, 2);
