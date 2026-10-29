-- ============================================================
-- Fecha y medio de la seña de turnos (estética/servicios/oficios) y
-- consultas (oficios). Sin esto la caja no sabe cuándo ni cómo entró
-- la seña cobrada por Mercado Pago/Stripe y no la puede sumar al
-- cierre de caja.
-- Correr contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-deposit-paid-at.sql
-- ============================================================

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS deposit_method text;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS deposit_method text;

CREATE INDEX IF NOT EXISTS bookings_deposit_paid_at_idx
  ON public.bookings (vendor_id, deposit_paid_at)
  WHERE deposit_status = 'paid';
CREATE INDEX IF NOT EXISTS quotes_deposit_paid_at_idx
  ON public.quotes (vendor_id, deposit_paid_at)
  WHERE deposit_status = 'paid';

-- Backfill: las señas ya cobradas no tenían fecha ni medio guardados.
-- Se sellan con now() para que aparezcan UNA sola vez en el primer cierre
-- posterior a la migración (no hay timestamp real confiable, así que se
-- documenta la aproximación). Idempotente: solo toca filas sin fecha.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'stripe_session_id') THEN
    UPDATE public.bookings
       SET deposit_paid_at = now(),
           deposit_method = CASE WHEN stripe_session_id IS NOT NULL THEN 'stripe' ELSE 'mercadopago' END
     WHERE deposit_status = 'paid' AND deposit_paid_at IS NULL;
  ELSE
    UPDATE public.bookings
       SET deposit_paid_at = now(), deposit_method = 'mercadopago'
     WHERE deposit_status = 'paid' AND deposit_paid_at IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'stripe_session_id') THEN
    UPDATE public.quotes
       SET deposit_paid_at = now(),
           deposit_method = CASE WHEN stripe_session_id IS NOT NULL THEN 'stripe' ELSE 'mercadopago' END
     WHERE deposit_status = 'paid' AND deposit_paid_at IS NULL;
  ELSE
    UPDATE public.quotes
       SET deposit_paid_at = now(), deposit_method = 'mercadopago'
     WHERE deposit_status = 'paid' AND deposit_paid_at IS NULL;
  END IF;
END $$;
