-- Productos pesables: confirmación de peso pre-cobro (moda/comercio).
-- `vendors.weight_confirm_mode`:
--   'estimado' (default) = como hasta hoy: el cliente declara los kilos y se
--     cobra el estimado al confirmar.
--   'confirmar' = el pedido con kg nace "pendiente de peso" (payment pending):
--     el comercio pesa, ajusta el total y recién ahí se cobra (link MP desde el
--     seguimiento, transferencia o efectivo al entregar).
-- `vendors.weight_tolerance_pct`: si el total real difiere del estimado más
--   allá de este %, el cliente tiene que tocar "Aceptar total" antes de pagar.
-- `orders.weight_confirmed_at`: sella cuándo el comercio confirmó el peso
--   (NULL = sin confirmar → el PATCH sigue aceptando edición de kg).
-- `orders.weight_estimated_total`: snapshot del estimado al crear el pedido,
--   para calcular la diferencia que ve el cliente.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS weight_confirm_mode text NOT NULL DEFAULT 'estimado';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS weight_tolerance_pct integer NOT NULL DEFAULT 20;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_estimated_total numeric(12,2);
-- Aprobación del cliente: si el total real difiere del estimado más allá de la
-- tolerancia, el cliente toca "Aceptar total" en el seguimiento antes de pagar.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS weight_approved_at timestamptz;

-- Pedidos pendientes de peso del comercio (badge del kanban / recordatorio).
CREATE INDEX IF NOT EXISTS orders_weight_pending_idx
  ON orders (vendor_id, created_at)
  WHERE weight_confirmed_at IS NULL AND weight_estimated_total IS NOT NULL;

COMMENT ON COLUMN vendors.weight_confirm_mode IS 'Cobro de pesables: estimado (default) | confirmar (pesa el comercio antes de cobrar)';
COMMENT ON COLUMN vendors.weight_tolerance_pct IS 'Diferencia % estimado vs real que el cliente puede pagar sin aprobar (default 20)';
