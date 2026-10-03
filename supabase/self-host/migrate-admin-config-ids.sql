-- ============================================================================
-- Admin Config/Métricas — columnas faltantes en neighborhoods/categories.
-- ----------------------------------------------------------------------------
-- El panel /admin/config (y sus APIs) trabaja con `id` (uuid) y con
-- `categories.vertical`, pero el esquema canónico solo tenía PK `slug`
-- (sin `id`) y `categories` no tenía `vertical`:
--   DELETE/UPDATE ... WHERE id = $1  →  Postgres: column "id" does not exist
--   → 500 en /api/admin/config* → página "Algo salió mal".
--
-- Columnas:
--   neighborhoods.id uuid (backfill automático por DEFAULT en filas existentes)
--   categories.id uuid (idem)
--   categories.vertical text (NULL = todas / sin filtro)
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-admin-config-ids.sql
-- ============================================================================

ALTER TABLE public.neighborhoods
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_neighborhoods_id'
  ) THEN
    ALTER TABLE public.neighborhoods ADD CONSTRAINT uq_neighborhoods_id UNIQUE (id);
  END IF;
END $$;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS vertical text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_categories_id'
  ) THEN
    ALTER TABLE public.categories ADD CONSTRAINT uq_categories_id UNIQUE (id);
  END IF;
END $$;

-- Las filas preexistentes reciben su uuid por el DEFAULT del ADD COLUMN.
-- Por seguridad, cubrir el caso de filas con id NULL (ej. columna creada
-- sin default en algún orden de aplicación distinto):
UPDATE public.neighborhoods SET id = gen_random_uuid() WHERE id IS NULL;
UPDATE public.categories SET id = gen_random_uuid() WHERE id IS NULL;
