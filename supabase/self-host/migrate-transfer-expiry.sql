-- M4.2 — Vencimiento de transferencias ("Pago vencido").
-- `vendors.transfer_expiry_hours`: horas que tiene el cliente para transferir
-- antes de que el pedido se cancele solo. NULL = desactivado (como hasta hoy).
-- `orders.transfer_deadline_at`: vencimiento concreto del pedido (se sella al
-- crear si el comercio tiene el vencimiento activo).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_expiry_hours integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transfer_deadline_at timestamptz;

-- Cron que auto-cancela los vencidos: /api/cron/transfer-expiry (20 min).
CREATE INDEX IF NOT EXISTS orders_transfer_deadline_idx
  ON orders (transfer_deadline_at)
  WHERE transfer_deadline_at IS NOT NULL;
