-- ============================================================================
-- Servicios — recordatorios de turnos + fotos en presupuestos.
-- ----------------------------------------------------------------------------
-- 1) Log de recordatorios (anti-duplicados): el job
--    GET /api/cron/booking-reminders (cron en el host, cada 15 min) avisa
--    T-24h (comercio + cliente) y T-2h (cliente) de turnos confirmados.
-- 2) quotes.photo_urls (jsonb): fotos del problema adjuntas por el cliente
--    (hasta 3, vía POST /api/service-upload). Se ven en la bandeja.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-service-reminders.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_reminder_log (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('t24', 't2')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_service_reminder_log_sent ON public.service_reminder_log(sent_at);

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
