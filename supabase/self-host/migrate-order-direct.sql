-- Venta directa de mostrador: marca pedidos que nacieron cerrados (sin flow).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-order-direct.sql

ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_direct boolean NOT NULL DEFAULT false;

-- Backfill: completadas de mostrador/retiro sin ningún cambio de estado
-- logueado nacieron directas (el order_status_log solo se escribe en PATCH,
-- nunca al crear; un pedido-retiro completado siempre deja rastro).
UPDATE orders o
SET is_direct = true
WHERE o.channel = 'mostrador'
  AND o.method = 'pickup'
  AND o.status = 'completed'
  AND o.is_direct IS DISTINCT FROM true
  AND NOT EXISTS (SELECT 1 FROM order_status_log l WHERE l.order_id = o.id);

CREATE INDEX IF NOT EXISTS idx_orders_direct ON public.orders(vendor_id, is_direct) WHERE is_direct = true;
