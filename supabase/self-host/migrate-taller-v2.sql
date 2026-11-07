-- ============================================================================
-- Vertical taller v2: recordatorio de service vencido, firma en entrega y
-- foto de recepción.
-- ----------------------------------------------------------------------------
-- 1) Log de recordatorios de service (anti-spam: 1 cada 90 días por equipo).
-- 2) Firma digital en entrega (canvas del cliente al cobrar/retirar).
-- 3) Foto de recepción del equipo (condición al ingreso, Velobench-style).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-taller-v2.sql
-- Idempotente. Sin esto: el cron de recordatorios responde {skipped:true},
-- la firma/foto se ignoran y el resto funciona igual.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.equipment_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'service_due' CHECK (kind IN ('service_due')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  last_service_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_equipment_reminder
  ON public.equipment_reminder_log (vendor_id, equipment_id, sent_at DESC);

-- Firma digital al entregar (canvas → dataURL jpeg comprimido).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS signature_data text,
  ADD COLUMN IF NOT EXISTS signature_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature_name text;

-- Foto de recepción del equipo (condición al ingreso, URL de /api/vendor/upload).
ALTER TABLE public.equipment
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN public.bookings.signature_data IS 'Orden/turno: firma del cliente al retirar (dataURL jpeg). NULL = sin firma.';
COMMENT ON COLUMN public.bookings.signature_at IS 'Momento de la firma.';
COMMENT ON COLUMN public.equipment.photo_url IS 'Foto de recepción del equipo (condición al ingreso).';
COMMENT ON TABLE public.equipment_reminder_log IS 'Anti-duplicados del recordatorio de service vencido (1 cada 90 días por equipo).';
