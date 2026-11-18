-- Ajuste post-cierre CON venta (faltante / duplicada).
--
-- El ajuste de caja puede corregir solo los números (comportamiento original),
-- pero cuando la causa es una venta que faltó registrar o una venta duplicada,
-- lo correcto es que exista/anule la venta real: stock, kardex, analytics,
-- ticket y CRM. Esta migración agrega el vínculo ajuste <-> pedido.
--
--   order_id:
--     - venta_faltante  -> la venta creada desde el Mostrador en modo ajuste.
--       Si se cobró con pago combinado, hay UNA fila por medio (todas con el
--       mismo order_id) para que el arqueo por medio quede bien.
--     - venta_duplicada -> la venta que se anuló desde el ajuste (una sola).
--     - otro            -> NULL (solo números).
--
-- El índice UNIQUE parcial impide ajustar dos veces la misma venta con el mismo
-- medio (las filas de una venta faltante combinada comparten order_id pero no
-- medio) y la anulación además valida que el pedido siga sin cancelar.
-- ON DELETE SET NULL: borrar el pedido no se lleva el rastro del ajuste (el
-- importe sigue corrigiendo el cierre).
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-adjustments-orders.sql

ALTER TABLE public.cash_closing_adjustments
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_closing_adj_order
  ON public.cash_closing_adjustments(order_id)
  WHERE order_id IS NOT NULL;

-- Una venta se puede ajustar una sola vez POR MEDIO: la venta faltante con
-- pago combinado puede generar varias filas (una por medio) y la anulación
-- también; lo que no puede pasar es duplicar el mismo medio (doble anulación /
-- doble alta). La anulación además valida que el pedido siga sin cancelar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_closing_adj_order_method
  ON public.cash_closing_adjustments(order_id, method, kind)
  WHERE order_id IS NOT NULL AND kind IN ('venta_faltante', 'venta_duplicada');

COMMENT ON COLUMN public.cash_closing_adjustments.order_id IS
  'Venta vinculada al ajuste: la creada (venta_faltante) o la anulada (venta_duplicada). NULL = ajuste de solo números.';
