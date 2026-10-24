-- ============================================================
-- Pago y cierre de turno (servicios / estética / oficios).
-- Un turno atendido pasa a status 'completed' con medio de pago,
-- monto cobrado en el acto y momento. La seña ya pagada se descuenta
-- del saldo. Opcional: Factura C (ARCA) vinculada al turno.
-- Correr contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-estetica-booking-payment.sql
-- ============================================================

-- Estado 'completed': turno atendido y cobrado (o pendiente de pago si fiado).
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'noshow', 'completed'));

-- Campos de cobro del turno (todos opcionales/tolerantes a migración pendiente).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(10, 2),
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Una factura puede vincularse a un pedido (orden) o a un turno.
ALTER TABLE public.invoices ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_vendor_booking_unique
  ON public.invoices (vendor_id, booking_id) WHERE booking_id IS NOT NULL;

-- Comentarios de documentación.
COMMENT ON COLUMN public.bookings.payment_status IS 'paid = cobrado total, pending = deuda/fiado';
COMMENT ON COLUMN public.bookings.payment_method IS 'efectivo|transferencia|tarjeta|mixto|whatsapp|fiado';
COMMENT ON COLUMN public.bookings.amount_paid IS 'Monto cobrado en el acto (saldo tras descontar seña pagada)';
COMMENT ON COLUMN public.bookings.paid_at IS 'Momento del cobro';
COMMENT ON COLUMN public.bookings.completed_at IS 'Momento en que el turno se dio por atendido';
COMMENT ON COLUMN public.invoices.booking_id IS 'Turno al que se le emitió esta Factura C (null si es de un pedido)';
