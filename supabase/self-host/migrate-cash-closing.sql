-- Cierre de caja (Z) — estilo Fudo — gastronomía (plan Gestión integral).
-- Cada cierre congela los cobros desde el último Z guardado (o el arranque del
-- día civil si no hay ninguno): totales por medio de pago, descuentos, neto,
-- y arqueo opcional (conteo físico de efectivo vs sistema, con diferencia).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-closing.sql

-- ============================================================
-- CIERRES DE CAJA
-- since: momento desde el que se computan los cobros (último Z anterior).
-- by_method: {efectivo: {count, total}, transferencia: {...}, ...} — lo
--   calcula la API, no se edita a mano.
-- cash_declared: conteo físico declarado de efectivo (arqueo, opcional).
-- cash_difference: cash_declared - efectivo_sistema (lo calcula la API).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  closed_at timestamptz NOT NULL DEFAULT now(),
  since timestamptz NOT NULL,
  orders_count int NOT NULL DEFAULT 0,
  gross_total numeric(12, 2) NOT NULL DEFAULT 0,
  discounts_total numeric(12, 2) NOT NULL DEFAULT 0,
  net_total numeric(12, 2) NOT NULL DEFAULT 0,
  by_method jsonb NOT NULL DEFAULT '{}'::jsonb,
  cash_declared numeric(12, 2),
  cash_difference numeric(12, 2),
  notes text,
  -- SET NULL: el usuario puede borrarse sin perder el historial de cierres.
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_closings_vendor ON public.cash_closings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_cash_closings_vendor_closed
  ON public.cash_closings(vendor_id, closed_at DESC);

-- Índice para el rango de cobros por paid_at (GET/POST del cierre y analytics).
CREATE INDEX IF NOT EXISTS idx_orders_vendor_paid_at
  ON public.orders(vendor_id, paid_at) WHERE paid_at IS NOT NULL;
