-- Descuento manual por venta ($ o % con motivo) para mostrador y mesas.
-- El comerciante lo carga al cobrar (ej: "cliente frecuente", "error de carga").
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-manual-discount.sql

-- Monto efectivamente descontado (misma idea que cash_discount/volume_discount).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount numeric(10, 2) NOT NULL DEFAULT 0;

-- Cómo se cargó: 'amount' ($ directo) o 'percent' (% sobre el subtotal).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount_kind text CHECK (manual_discount_kind IN ('amount', 'percent'));

-- Valor cargado (10 = 10% ó $10 según kind): permite recalcular el monto si
-- la cuenta crece (mesa: se suma otra consumición y el % sigue valiendo).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount_value numeric(10, 2);

-- Motivo corto opcional (ej: "cliente frecuente"). Sale en el ticket.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS manual_discount_reason text;
