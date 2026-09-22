-- ============================================================================
-- Servicios: solicitudes (turnos + presupuestos) + tope mensual gratuito.
-- ----------------------------------------------------------------------------
-- Fase 0 (bugs): bookings guarda nombre/teléfono del cliente (la agenda del
--   comercio los necesita para recontactar por WhatsApp).
-- Fase 1 (gratuito con tope): plans.max_quotes_month — tope mensual COMBINADO
--   de presupuestos + turnos no cancelados. NULL = ilimitado. El plan
--   gratuito trae 5 (configurable por admin en /admin/planes).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-service-requests.sql
-- ============================================================================

-- Cliente del turno (venían solo en el texto de la notificación y se perdían).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS customer_phone text;

-- Tope mensual de solicitudes (quotes + bookings) por mes calendario.
-- NULL = ilimitado.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_quotes_month int NULL;
COMMENT ON COLUMN public.plans.max_quotes_month IS
  'Tope de presupuestos + turnos (no cancelados) por mes calendario. NULL = ilimitado.';

-- Gratuito: 5 solicitudes/mes (tope combinado, configurable por admin).
UPDATE public.plans SET max_quotes_month = 5 WHERE slug = 'gratuito';
-- Planes pagos gastro/comercio: sin tope de solicitudes.
UPDATE public.plans SET max_quotes_month = NULL WHERE slug IN ('pedidos', 'gestion');
