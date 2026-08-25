-- Agregar campo para notas de modificación del pedido
ALTER TABLE orders ADD COLUMN IF NOT EXISTS modification_notes text;
