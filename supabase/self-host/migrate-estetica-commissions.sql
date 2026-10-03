-- ============================================================================
-- Estética — comisiones por servicio/profesional (v1: solo reporte, sin
-- split automático de dinero).
-- ----------------------------------------------------------------------------
-- - services.price: precio de lista del servicio (se muestra en el
--   micrositio y es la base de la comisión).
-- - services.commission_pct: % del profesional en ESE servicio (NULL = usa
--   el % del profesional).
-- - estetica_staff.commission_pct: % default del profesional (NULL/0 = sin
--   comisión).
-- - bookings.service_price / bookings.commission_pct: snapshot al crear el
--   turno (precio y % vigentes en ese momento; el reporte no cambia si
--   después se editan).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-commissions.sql
-- ============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS commission_pct numeric(5, 2);

ALTER TABLE public.estetica_staff
  ADD COLUMN IF NOT EXISTS commission_pct numeric(5, 2);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS commission_pct numeric(5, 2);
