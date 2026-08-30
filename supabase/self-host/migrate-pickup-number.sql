-- Número de retiro en mostrador (para pedidos con retiro en local).
-- Número correlativo por día, distinto del id del pedido; referencia al cliente que retira.
-- Correr contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f <ruta>/migrate-pickup-number.sql

ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_number integer;
CREATE INDEX IF NOT EXISTS idx_orders_pickup_number ON orders(vendor_id, pickup_number);