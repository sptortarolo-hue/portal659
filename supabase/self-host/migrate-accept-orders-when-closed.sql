-- Permitir recibir pedidos online aunque el comercio esté cerrado.
-- Default false: comportamiento actual (cerrado ⇒ no se puede pedir).
-- Idempotente.
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS accept_orders_when_closed boolean NOT NULL DEFAULT false;
