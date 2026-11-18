-- Ajustes post-cierre de caja (Z).
-- El Z congela los números del período y no se reescribe. Cuando después se
-- descubre que una venta quedó sin registrar, se registró dos veces o se cargó
-- con el medio de pago equivocado, este ajuste corrige el cierre SIN mover
-- dinero: queda guardado con motivo, autor y fecha, y el panel / A4 / ticket
-- muestran el neto y la diferencia "ajustados" al lado de los originales
-- (rastro de auditoría, estilo cash adjustment de Lightspeed/Square).
--
-- amount: firmado.
--   + = faltaba registrar plata (el sistema esperaba menos que la realidad):
--       sube el neto y, si es efectivo, el efectivo esperado.
--   − = había plata registrada de más (venta duplicada): baja el neto y, si
--       es efectivo, el efectivo esperado.
-- method: medio de pago corregido (efectivo / transferencia / tarjeta / ...).
-- kind:   venta_faltante | venta_duplicada | otro.
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-adjustments.sql

CREATE TABLE IF NOT EXISTS public.cash_closing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  closing_id uuid NOT NULL REFERENCES public.cash_closings(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount <> 0),
  method text NOT NULL DEFAULT 'efectivo',
  kind text NOT NULL DEFAULT 'otro'
    CHECK (kind IN ('venta_faltante', 'venta_duplicada', 'otro')),
  reason text NOT NULL,
  -- SET NULL: el usuario puede borrarse sin perder el ajuste.
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_closing_adj_vendor
  ON public.cash_closing_adjustments(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_closing_adj_closing
  ON public.cash_closing_adjustments(closing_id);
