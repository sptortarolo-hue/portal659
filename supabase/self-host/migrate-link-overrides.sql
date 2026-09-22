-- Override de min/max por producto en el link (caso heladería: UN grupo
-- "Gustos" con distinta cantidad por tamaño: 1/4 → 2, 1/2 → 3, 1 kg → 5).
--
-- Semántica: NULL = vale el default del grupo. Efectivo =
--   COALESCE(link.max_selections, grupo.max_selections)
-- Los lectores usan el helper queryEffectiveModifiers (src/lib/modifier-rules.ts)
-- que ya contempla que esta migración aún no esté aplicada.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-link-overrides.sql

ALTER TABLE public.product_modifier_links
  ADD COLUMN IF NOT EXISTS max_selections int NULL,
  ADD COLUMN IF NOT EXISTS min_selections int NULL;

-- Saneamiento defensivo por si las columnas ya existían con valores inválidos.
UPDATE public.product_modifier_links
  SET max_selections = NULL
  WHERE max_selections IS NOT NULL AND max_selections < 1;
UPDATE public.product_modifier_links
  SET min_selections = NULL
  WHERE min_selections IS NOT NULL AND min_selections < 0;
