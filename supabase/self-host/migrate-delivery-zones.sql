-- migrate-delivery-zones.sql
-- Envío por zona del comercio (4 perfiles: gratis / tarifa única / hasta 3
-- zonas / gratis desde $X). Sin mapas ni geocoding: la zona la autodeclara
-- el cliente (web) o la elige el comerciante (mostrador).
--
--   - vendors.delivery_mode: 'flat' (default, comportamiento actual:
--     delivery_fee único) | 'zones' (hasta 3 tarifas por zona).
--   - vendors.delivery_area_text: descripción en lenguaje barrial del área
--     habitual (ej: "Sicardi y Garibaldi, hasta la calle 22"). Se muestra
--     en el checkout (pregunta dentro/fuera) y en el mostrador.
--   - vendors.delivery_fee sigue existiendo: en modo flat es la tarifa
--     única; en modo zones es el provisorio fuera de zona ("a convenir").
--   - free_delivery_min (global) aplica a ambos modos, salvo "otra zona".
--   - orders.delivery_out_of_area: pedido fuera del área (entra igual, el
--     comercio ajusta la diferencia por WhatsApp).
--   - orders.delivery_zone_id/name: zona elegida (name denormalizado para
--     ticket/historial aunque la zona se borre).

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS delivery_mode text NOT NULL DEFAULT 'flat'
    CHECK (delivery_mode IN ('flat', 'zones')),
  ADD COLUMN IF NOT EXISTS delivery_area_text text;
COMMENT ON COLUMN public.vendors.delivery_mode IS
  'flat = tarifa única (delivery_fee); zones = hasta 3 tarifas por zona (delivery_zones).';
COMMENT ON COLUMN public.vendors.delivery_area_text IS
  'Área de reparto habitual en lenguaje barrial (ej: "Sicardi y Garibaldi, hasta la 22").';

CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  fee numeric(10, 2) NOT NULL DEFAULT 0,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.delivery_zones IS
  'Zonas de reparto propias del comercio (máx 3 activas, se enforcea en la API). Sin geometría: nombre + descripción barrial.';
CREATE INDEX IF NOT EXISTS idx_delivery_zones_vendor
  ON public.delivery_zones(vendor_id, position);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_out_of_area boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_zone_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_zone_name text,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(10, 2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.orders.delivery_out_of_area IS
  'true = fuera del área habitual: el pedido entra con envío provisorio/a convenir.';
COMMENT ON COLUMN public.orders.delivery_fee IS
  'Fee de envío resuelto server-side al crear/convertir (desglose exacto en ticket/WhatsApp).';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_delivery_zone') THEN
    ALTER TABLE public.orders ADD CONSTRAINT fk_orders_delivery_zone
      FOREIGN KEY (delivery_zone_id) REFERENCES public.delivery_zones(id) ON DELETE SET NULL;
  END IF;
END $$;
