-- Plano visual de mesas: posición, tamaño y forma en el salón.
-- Las mesas existentes quedan en (0,0) con tamaño 60x60 y forma cuadrada.

ALTER TABLE tables ADD COLUMN IF NOT EXISTS x integer NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS y integer NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS width integer NOT NULL DEFAULT 60;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS height integer NOT NULL DEFAULT 60;
ALTER TABLE tables ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'square';
ALTER TABLE tables ADD COLUMN IF NOT EXISTS rotation integer NOT NULL DEFAULT 0;

-- Constraint de forma válida
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_shape_check'
  ) THEN
    ALTER TABLE tables ADD CONSTRAINT tables_shape_check
      CHECK (shape IN ('square', 'round', 'rectangle'));
  END IF;
END $$;

-- Constraint de dimensiones razonables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tables_size_check'
  ) THEN
    ALTER TABLE tables ADD CONSTRAINT tables_size_check
      CHECK (width >= 20 AND width <= 400 AND height >= 20 AND height <= 400);
  END IF;
END $$;
