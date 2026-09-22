-- Mínimo de selecciones por grupo de modificadores (caso heladería:
-- 1/4 kg → grupo "Gustos" con min 2 y max 2; 1/2 kg → min 1/max 3, etc.).
--
-- Semántica (igual en cliente y servidor, ver src/lib/modifier-select.ts):
--   min_selections NULL = comportamiento legacy (obligatorio exige ≥1).
--   Solo tiene efecto si el grupo es obligatorio (required/is_variant);
--   el editor fuerza NULL cuando el grupo es opcional.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-min-selections.sql

ALTER TABLE public.modifier_groups
  ADD COLUMN IF NOT EXISTS min_selections int NULL;

-- Saneamiento defensivo por si la columna ya existía con valores inválidos.
UPDATE public.modifier_groups
  SET min_selections = NULL
  WHERE min_selections IS NOT NULL AND min_selections < 0;
