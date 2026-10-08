-- Pase de turno: entrega opcional al cerrar + eslabón entre turnos.
-- handed_to_*: a quién se entrega la caja (NULL = cierre común, sin receptor).
-- previous_shift_id: el open lo setea solo = último turno cerrado (cadena).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-handover.sql

ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS handed_to_profile uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS handed_to_name text;
ALTER TABLE public.cash_shifts
  ADD COLUMN IF NOT EXISTS previous_shift_id uuid REFERENCES public.cash_shifts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cash_shifts_previous
  ON public.cash_shifts(previous_shift_id) WHERE previous_shift_id IS NOT NULL;
