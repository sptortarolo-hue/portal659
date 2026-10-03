-- ============================================================================
-- Visitas a micrositios (/store_visits) para métricas de funnel:
-- visitas únicas por comercio + conversión visita → pedido → compra.
-- ----------------------------------------------------------------------------
-- Una fila por (comercio, dispositivo, día): el UNIQUE acota el crecimiento
-- y hace el beacon idempotente (ON CONFLICT DO NOTHING).
-- `device_id` = cookie `portal659-did` (la pone el proxy, 1 año).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-store-visits.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.store_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  day date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_store_visits_vendor_device_day UNIQUE (vendor_id, device_id, day)
);

CREATE INDEX IF NOT EXISTS idx_store_visits_vendor_created
  ON public.store_visits(vendor_id, created_at DESC);
