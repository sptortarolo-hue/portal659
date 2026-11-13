-- ============================================================
-- QR de MP imputable a un TURNO (seña cobrada en el local).
-- Sin esta columna el QR sigue funcionando para pedidos; solo que
-- una seña de turno cobrada por QR no se puede marcar automática.
-- Correr contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-mp-qr-booking.sql
-- ============================================================

ALTER TABLE public.mp_qr_orders ADD COLUMN IF NOT EXISTS booking_id uuid;

CREATE INDEX IF NOT EXISTS idx_mp_qr_orders_booking
  ON public.mp_qr_orders (vendor_id, booking_id)
  WHERE booking_id IS NOT NULL;
