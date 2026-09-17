-- Productos que se venden en packs (ej: sandwiches de miga de a 6, por gusto).
-- `pack_size` = cantidad mínima/múltiplo de venta. NULL = se vende por unidad.
-- Cuando está seteado, `products.price` es el PRECIO DEL PAQUETE (de `pack_size`
-- unidades) y la unidad derivada = price / pack_size.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-pack-size.sql

ALTER TABLE products ADD COLUMN IF NOT EXISTS pack_size integer CHECK (pack_size >= 2);