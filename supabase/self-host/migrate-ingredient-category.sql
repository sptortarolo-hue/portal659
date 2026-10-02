-- Categoría de ingredientes (para import FUDO: hoja 3 trae Categoría*).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-ingredient-category.sql
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS idx_ingredients_vendor_category ON public.ingredients(vendor_id, category);
