-- Decoración del salón: paredes, etiquetas y zonas para delimitar espacios
-- en el editor del plano (las mesas se ubican encima).

CREATE TABLE IF NOT EXISTS floor_decor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  kind text NOT NULL,
  x integer NOT NULL DEFAULT 0,
  y integer NOT NULL DEFAULT 0,
  w integer NOT NULL DEFAULT 60,
  h integer NOT NULL DEFAULT 60,
  rotation integer NOT NULL DEFAULT 0,
  text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'floor_decor_kind_check'
  ) THEN
    ALTER TABLE floor_decor ADD CONSTRAINT floor_decor_kind_check
      CHECK (kind IN ('wall', 'label', 'rect', 'circle'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_floor_decor_vendor
  ON floor_decor (vendor_id);

-- Foto de fondo opcional del canvas (croquis/foto del salón).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS floor_bg_url text;
