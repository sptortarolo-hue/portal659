-- Refresco en tiempo real del dashboard (SSE): el stream filtra por
-- `orders.updated_at`, que debe existir y actualizarse en cada UPDATE.
-- Idempotente: seguro para DBs creadas con un schema.sql anterior.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill: filas viejas sin updated_at toman created_at.
UPDATE public.orders SET updated_at = created_at WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
