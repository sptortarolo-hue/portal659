-- Servicios/estética: flag de prueba en turnos y consultas (paridad con
-- orders.is_preview). Sin esto los turnos/consultas de prueba cuentan para el
-- tope del plan, disparan recordatorios, suman al libro del cliente y consumen
-- sesiones de packs. Idempotente.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_preview boolean NOT NULL DEFAULT false;
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS is_preview boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS bookings_vendor_preview
  ON public.bookings (vendor_id, is_preview);
CREATE INDEX IF NOT EXISTS quotes_vendor_preview
  ON public.quotes (vendor_id, is_preview);
