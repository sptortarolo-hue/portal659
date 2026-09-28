-- ============================================================================
-- Servicios — presupuestos/turnos manuales + clientes con historial.
-- ----------------------------------------------------------------------------
-- - quotes.origin / bookings.origin ('portal'|'vendor'): los manuales NO
--   cuentan para el tope gratuito (service-quota filtra origin='portal').
-- - quote_items: partidas del presupuesto (material/mano de obra). quoted_price
--   = total calculado (cache).
-- - bookings.status += 'noshow' (solo fecha pasada, regla Fresha).
-- - bookings.duration_min (default 60) + bookings.quote_id (convertir
--   presupuesto → turno).
-- - Índices por teléfono para historial por cliente.
-- - Plan oficios: crm → true (base de clientes con historial en Oficios).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-service-manual.sql
-- ============================================================================

-- Origen de la solicitud (portal = online del cliente, vendor = manual del comercio).
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'portal'
    CHECK (origin IN ('portal', 'vendor'));
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'portal'
    CHECK (origin IN ('portal', 'vendor'));

-- Partidas del presupuesto (materiales + mano de obra).
CREATE TABLE IF NOT EXISTS public.quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'material' CHECK (kind IN ('material', 'labor')),
  description text NOT NULL,
  qty numeric(10, 2) NOT NULL DEFAULT 1,
  unit_price numeric(10, 2) NOT NULL DEFAULT 0,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON public.quote_items(quote_id);

-- Turno: ausente + duración + link al presupuesto que lo originó.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS duration_min int;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'noshow'));

-- Historial por cliente: índices por teléfono.
CREATE INDEX IF NOT EXISTS idx_quotes_vendor_phone ON public.quotes(vendor_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor_phone ON public.bookings(vendor_id, customer_phone);

-- Clientes con historial: feature del plan Oficios.
UPDATE public.plans SET features = features || '{"crm": true}'::jsonb WHERE slug = 'oficios';
