-- Caché de lookup de códigos de barras (Open Food Facts).
-- Evita re-consultar la API y deja métrica de aciertos (hit_count).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-barcode-cache.sql

CREATE TABLE IF NOT EXISTS public.barcode_cache (
  code text PRIMARY KEY,
  name text,
  brand text,
  image_url text,
  source text NOT NULL DEFAULT 'off',
  hit_count integer NOT NULL DEFAULT 1,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
