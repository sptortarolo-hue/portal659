-- ============================================================================
-- Estética — agenda de la turnera: modo, disponibilidad por profesional y
-- ajustes por fecha.
-- ----------------------------------------------------------------------------
-- 1) vendors.booking_schedule_mode: 'hours' (sigue el horario del local, como
--    hoy) o 'grid' (agenda planificada por profesional; lo no marcado se
--    bloquea). Default 'hours' => el comportamiento actual no cambia.
-- 2) estetica_staff.availability (jsonb): grilla semanal RECURRENTE por
--    profesional, mismo formato que vendors.hours pero sin el prefijo de día:
--      {"lun":[["09:00","13:00"],["17:00","20:00"]], ..., "dom":[]}
--    NULL = cae al horario del local (permite activar la agenda gradualmente).
-- 3) staff_schedule_days: ajustes POR FECHA encima del base (abrir con hora
--    propia o cerrar un día puntual). ranges [] = cerrado ese día.
--    Convive con estetica_blocks (bloqueo total sigue por ahí).
--
-- Idempotente. Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-schedule.sql
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS booking_schedule_mode text NOT NULL DEFAULT 'hours';
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.vendors'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%booking_schedule_mode%' LOOP
    EXECUTE format('ALTER TABLE public.vendors DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.vendors
    ADD CONSTRAINT vendors_booking_schedule_mode_check
    CHECK (booking_schedule_mode IN ('hours', 'grid'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

ALTER TABLE public.estetica_staff
  ADD COLUMN IF NOT EXISTS availability jsonb;

CREATE TABLE IF NOT EXISTS public.staff_schedule_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.estetica_staff(id) ON DELETE CASCADE,
  day date NOT NULL,
  ranges jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_schedule_days_vendor_staff_day
  ON public.staff_schedule_days (vendor_id, staff_id, day);
CREATE INDEX IF NOT EXISTS staff_schedule_days_vendor_day
  ON public.staff_schedule_days (vendor_id, day);
