-- M4.1 — Cancelación con motivo y autor.
-- `cancel_reason`: texto electivo que el comercio elige al rechazar/cancelar
-- (se muestra al cliente en push/mis-pedidos/seguimiento).
-- `cancelled_by`: quién canceló (el comercio hoy, "Sistema (pago vencido)"
-- mañana con el cron de M4.2).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by text;
