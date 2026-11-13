-- Reglas de peso por producto (mostrador con balanza).
-- `products.weight_step_kg`: múltiplo de venta en kg para productos pesables (0/NULL = libre).
-- `products.weight_min_kg`: peso mínimo de venta en kg (0/NULL = sin mínimo).
-- Se agregan a products para que el endpoint /api/wa/menu las devuelva al bot de WhatsApp.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-weight-step-products.sql

ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_step_kg numeric(6,3);
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_min_kg numeric(6,3);

COMMENT ON COLUMN products.weight_step_kg IS 'Múltiplo de venta en kg para productos pesables (0/NULL = libre)';
COMMENT ON COLUMN products.weight_min_kg IS 'Peso mínimo de venta en kg (0/NULL = sin mínimo)';
