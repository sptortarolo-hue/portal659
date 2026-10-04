-- Estética: bloqueos de agenda (feriados/vacaciones) + política de no-show.
-- Idempotente: se puede correr varias veces.
-- Sin esto: la turnera no ofrece cerrar días puntuales (slots/POST ignoran
-- la tabla), la política de ausente cae a 'none' y la seña no tiene 'forfeited'.

-- Días bloqueados: staff_id NULL = todo el centro; si no, solo ese profesional.
CREATE TABLE IF NOT EXISTS public.estetica_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  staff_id uuid NULL REFERENCES public.estetica_staff(id) ON DELETE CASCADE,
  block_date date NOT NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS estetica_blocks_vendor_day_staff
  ON public.estetica_blocks (vendor_id, block_date, COALESCE(staff_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS estetica_blocks_vendor_day
  ON public.estetica_blocks (vendor_id, block_date);

-- Política ante ausente: 'none' (solo marca) o 'forfeit' (retiene seña pagada).
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS noshow_policy text NOT NULL DEFAULT 'none';
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.vendors'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%noshow_policy%' LOOP
    EXECUTE format('ALTER TABLE public.vendors DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.vendors
    ADD CONSTRAINT vendors_noshow_policy_check CHECK (noshow_policy IN ('none', 'forfeit'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Seña retenida por no-show: suma 'forfeited' al check de bookings.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.bookings'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%deposit_status%' LOOP
    EXECUTE format('ALTER TABLE public.bookings DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_deposit_status_check
    CHECK (deposit_status IN ('none', 'pending', 'paid', 'forfeited'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
