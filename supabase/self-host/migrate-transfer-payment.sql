-- Migración: Transferencias por WhatsApp + verificación de pago
-- 1) Titular de la cuenta (alias ya existe en vendors.transfer_alias)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_holder text;

-- 2) Bloquear pedidos hasta confirmar pago (toggle por comercio)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS block_unpaid_orders boolean NOT NULL DEFAULT false;

-- 3) Estado de pago del pedido (pago != cumplimiento). Default 'paid' para no romper pedidos existentes.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'paid';
