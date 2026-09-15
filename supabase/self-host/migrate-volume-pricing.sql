-- Precios por volumen (gastro): grupos mixtos de productos + tramos por cantidad.
-- Ej: grupo "Empanadas" = [carne, JyQ, pollo] con tramos 6x$10.000 / 12x$18.000.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-volume-pricing.sql

-- Grupo de volumen: set explícito de productos (opción A). Los flags de
-- combinación son editables por grupo (defaults = volumen gana, sin cash,
-- extras con costo aparte).
CREATE TABLE IF NOT EXISTS volume_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  product_ids uuid[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  -- ¿El volumen calcula sobre la promo (true) o la pisa con el precio base (false)?
  combine_promo boolean NOT NULL DEFAULT false,
  -- ¿El % de efectivo se suma sobre el neto del grupo (true) o no corre (false)?
  combine_cash boolean NOT NULL DEFAULT false,
  -- Extras con costo: 'on_top' se cobran aparte, 'included' los absorbe el pack.
  extras_mode text NOT NULL DEFAULT 'on_top' CHECK (extras_mode IN ('on_top', 'included')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS volume_groups_vendor_idx ON volume_groups (vendor_id);

-- Tramo: a partir de min_qty rige kind/value.
-- 'fixed_total' = el set de min_qty sale $value (ej: 12x $18.000).
-- 'percent_off' = todo el grupo con value% off (ej: 6+ con 10% off).
CREATE TABLE IF NOT EXISTS volume_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES volume_groups(id) ON DELETE CASCADE,
  min_qty integer NOT NULL CHECK (min_qty >= 2),
  kind text NOT NULL CHECK (kind IN ('fixed_total', 'percent_off')),
  value numeric(10, 2) NOT NULL CHECK (value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, min_qty)
);

CREATE INDEX IF NOT EXISTS volume_tiers_group_idx ON volume_tiers (group_id);

-- Descuento por volumen a nivel pedido (misma idea que cash_discount).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS volume_discount numeric(10, 2) NOT NULL DEFAULT 0;
