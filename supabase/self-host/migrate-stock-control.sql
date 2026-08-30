-- Migración: Control de stock por plato (toggle)
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_control boolean NOT NULL DEFAULT false;
