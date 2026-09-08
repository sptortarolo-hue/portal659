-- Frena el cronómetro de los pedidos concluidos.
-- closed_at guarda el momento en que el pedido pasó a completed/cancelled,
-- para que el "Tardó X min" no siga corriendo después de cerrarse.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS closed_at timestamptz;

-- Backfill para pedidos ya finalizados: mejor dato disponible = log de estado,
-- si no, updated_at (que se setea al cambiar de estado).
UPDATE orders o
SET closed_at = COALESCE(
  (SELECT l.created_at FROM order_status_log l
   WHERE l.order_id = o.id AND l.status IN ('completed', 'cancelled')
   ORDER BY l.created_at DESC LIMIT 1),
  o.updated_at
)
WHERE o.status IN ('completed', 'cancelled') AND o.closed_at IS NULL;