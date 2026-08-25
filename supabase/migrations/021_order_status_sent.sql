-- Agregar estado 'sent' (enviado) para delivery
-- Flujo delivery: new -> confirmed -> preparing -> ready -> sent -> completed
-- Flujo pickup:   new -> confirmed -> preparing -> ready -> completed (sin cambios)

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'sent', 'completed', 'cancelled'));
