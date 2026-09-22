-- ============================================================
-- Apartado / seña (vertical moda): reserva con pago parcial + vencimiento.
-- El pedido nace con is_apartado=true y status='new'; la seña se cobra
-- en efectivo/transferencia (manual) o con link de Mercado Pago
-- (rama portal659_apartado_ del webhook); el saldo se marca cobrado y el
-- pedido entra al circuito normal (confirmed → ...). Al cancelar se repone
-- stock con el flujo existente. mp_payment_id con IF NOT EXISTS por si la
-- migración migrate-order-mp-payment-id.sql ya lo creó.
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_apartado boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_amount numeric(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_pct numeric(5, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_due_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS remainder_paid_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mp_payment_id text;

CREATE INDEX IF NOT EXISTS idx_orders_apartado
  ON orders(vendor_id, is_apartado) WHERE is_apartado = true;
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment_id
  ON orders(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
