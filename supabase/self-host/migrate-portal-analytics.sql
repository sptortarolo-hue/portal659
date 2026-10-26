-- ============================================================================
-- Tráfico e interacción del portal (first-party, patrón store_visits):
--   portal_page_views — 1 fila por (página, dispositivo, día)
--   portal_events     — interacciones: search | wa_click | store_open
-- ----------------------------------------------------------------------------
-- El dedupe vive en el UNIQUE + ON CONFLICT DO NOTHING: 1 beacon repetido
-- nunca infla nada y el crecimiento queda acotado a dispositivos × páginas.
-- `device_id` = cookie `portal659-did` (1 año, la repone /api/track-page).
--
-- DÍA EN HUSO ARGENTINA: el contenedor de Postgres corre en UTC, por eso el
-- default y las lecturas usan la conversión explícita a Buenos Aires (los
-- beacons además pasan `day` explícito — ver src/lib/analytics-day.ts —, así
-- escritura y lectura de /api/admin/traffic coinciden siempre).
--
-- Aplicar contra el contenedor (el archivo vive en el HOST):
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < supabase/self-host/migrate-portal-analytics.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL CHECK (length(path) <= 300),
  device_id text NOT NULL,
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_portal_pv_path_device_day UNIQUE (path, device_id, day)
);

CREATE INDEX IF NOT EXISTS idx_portal_pv_day ON public.portal_page_views(day DESC);
CREATE INDEX IF NOT EXISTS idx_portal_pv_path_day ON public.portal_page_views(path, day DESC);

CREATE TABLE IF NOT EXISTS public.portal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('search', 'wa_click', 'store_open')),
  value text CHECK (value IS NULL OR length(value) <= 120),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  path text CHECK (path IS NULL OR length(path) <= 300),
  device_id text NOT NULL,
  day date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_events_kind_day
  ON public.portal_events(kind, day DESC);
CREATE INDEX IF NOT EXISTS idx_portal_events_vendor_kind_day
  ON public.portal_events(vendor_id, kind, day DESC);
