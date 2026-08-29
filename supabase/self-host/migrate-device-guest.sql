-- Identidad de dispositivo (favoritos de invitado) + reconocimiento por teléfono
-- Correr contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f <ruta>/migrate-device-guest.sql

-- Favoritos: permiten user_id vacío y guardan por dispositivo
ALTER TABLE favorites ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS device_id text;

-- Reemplazar el UNIQUE(user_id, vendor_id) por índices parciales (uno por modo)
ALTER TABLE favorites DROP CONSTRAINT IF EXISTS favorites_user_id_vendor_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_user ON favorites(user_id, vendor_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_device ON favorites(device_id, vendor_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_favorites_device ON favorites(device_id);

-- Pedidos: dispositivo de origen (para "mis pedidos" de invitado)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_id text;
CREATE INDEX IF NOT EXISTS idx_orders_device ON orders(device_id) WHERE device_id IS NOT NULL;