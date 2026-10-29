-- Precios por volumen para productos por peso (kg).
-- Permite tramos decimales (0.5 kg, 1.5 kg, ...) y el nuevo tipo 'unit_price'
-- (precio por kg/unidad a partir de N, umbral acumulativo).
-- Idempotente: se puede correr varias veces.

-- 1. min_qty pasa de integer a numeric para soportar kilos fraccionarios.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'volume_tiers' AND column_name = 'min_qty' AND data_type = 'integer'
  ) THEN
    ALTER TABLE volume_tiers ALTER COLUMN min_qty TYPE numeric(10,3) USING min_qty::numeric;
  END IF;
END $$;

-- 2. CHECK de min_qty: permite desde 0.1 kg (antes >= 2 unidades).
ALTER TABLE volume_tiers DROP CONSTRAINT IF EXISTS volume_tiers_min_qty_check;
ALTER TABLE volume_tiers ADD CONSTRAINT volume_tiers_min_qty_check CHECK (min_qty >= 0.1 AND min_qty <= 999);

-- 3. CHECK de kind: suma 'unit_price' (precio por unidad a partir de N).
ALTER TABLE volume_tiers DROP CONSTRAINT IF EXISTS volume_tiers_kind_check;
ALTER TABLE volume_tiers ADD CONSTRAINT volume_tiers_kind_check CHECK (kind IN ('fixed_total', 'percent_off', 'unit_price'));

-- 4. Asegurar que el CHECK de value siga vigente (sin cambios).
ALTER TABLE volume_tiers DROP CONSTRAINT IF EXISTS volume_tiers_value_check;
ALTER TABLE volume_tiers ADD CONSTRAINT volume_tiers_value_check CHECK (value > 0);
