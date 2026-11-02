-- ============================================================
-- Pagos combinados (split payments): el desglose real de cómo se
-- cobró una venta. Reemplaza el valor único `orders.payment_method`
-- (que hoy guarda "mixto" sin desglose y por eso el arqueo mentía)
-- por una fila por medio de pago, cada una con su monto.
--
-- Modelo (patrón Square / Toast / Shopify / Fudo "pagos múltiples"):
--  - una venta tiene N "tenders"; el estado "pagado" = suma >= total.
--  - `tendered` solo en efectivo: lo que entregó el cliente, para
--    imprimir "Abona con / Vuelto" (el aplicado es `amount`).
--  - `kind='cobro'`  → el cobro de la venta (mostrador / cierre mesa),
--                      compartido por las consumiciones cerradas.
--  - `kind='parcial'`→ cobro parcial de mesa (order_id NULL, table_id
--                      set): la plata entró al cajón antes del cierre.
--
-- La Caja (Z y arqueo) suma estas filas por medio; los pedidos sin
-- filas (online/viejos) siguen cayendo a `payment_method` como hoy.
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-order-payments.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  table_id uuid REFERENCES public.tables(id) ON DELETE SET NULL,
  method text NOT NULL
    CHECK (method IN ('efectivo', 'transferencia', 'tarjeta')),
  amount numeric(12, 2) NOT NULL
    CHECK (amount > 0),
  -- Efectivo: lo que entregó el cliente (>= amount). NULL = no se cargó.
  tendered numeric(12, 2)
    CHECK (tendered IS NULL OR tendered >= amount),
  kind text NOT NULL DEFAULT 'cobro'
    CHECK (kind IN ('cobro', 'parcial')),
  -- Idempotencia del sync offline (mismo patrón que orders.client_key).
  client_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_order_payments_vendor_created
  ON public.order_payments(vendor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_payments_order
  ON public.order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_table
  ON public.order_payments(table_id);
-- Idempotencia por vendor: un reintento del sync no duplica la fila.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_payments_client_key
  ON public.order_payments(vendor_id, client_key)
  WHERE client_key IS NOT NULL;

-- Marca de cobertura: el pedido quedó cubierto por filas de order_payments
-- (no por el `payment_method` único). La Caja (Z) usa este flag para no
-- contar dos veces: con filas, el desglose; sin flag, cae al método único
-- de siempre (online y pedidos anteriores a esta migración).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS paid_via_payments boolean NOT NULL DEFAULT false;
