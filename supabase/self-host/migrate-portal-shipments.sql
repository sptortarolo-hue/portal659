-- migrate-portal-shipments.sql
-- "Portal 659 Envíos": envíos extendidos a zonas fuera del radio barrial,
-- operados por logísticas partner (retiro, tracking y entrega con prueba).
--
--   - carriers: logísticas partner dadas de alta en /admin/logisticas. En v1 la
--     operación es manual (panel operador dentro del portal), sin API externa.
--   - shipping_zones: catálogo del portal ("zonas extendidas" con precio plano).
--   - vendor_ship_zones: opt-in por comercio (activa la zona en su checkout).
--   - shipments: un envío físico por pedido delivery con zona extendida;
--     código público (oblea/QR) + eventos con foto (POD).
--   - shipment_events: timeline pública del tracking (para /envio/[code]).
--   - carrier_operators: usuarios (profiles) vinculados a una logística
--     para operar /envios (equivalente a vendor_staff pero a nivel carrier).
--
-- Los pedidos NUNCA cambian sus estados existentes: el envío siguiente de la
-- cantidad de carriers se mapea picked_up/in_transit → order 'sent' y
-- delivered → 'completed'. Tolerante: el checkout y los pedidos funcionan
-- igual sin esta migración (sin zonas extendidas ni envíos).

-- ---------------------------------------------------------------------------
-- Logísticas partner (alta y moderación en /admin/logisticas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.carriers IS
  'Logísticas partner que retiran/entregan envíos extendidos. En v1 operan desde el panel operador del portal, sin integración externa.';
CREATE INDEX IF NOT EXISTS idx_carriers_active ON public.carriers(active);

-- ---------------------------------------------------------------------------
-- Catálogo del portal: zonas extendidas con precio plano
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipping_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price numeric(10, 2) NOT NULL DEFAULT 0,
  eta_days integer NOT NULL DEFAULT 2,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.shipping_zones IS
  'Catálogo del portal: zonas de envío extendidas (fuera del radio barrial) con precio plano y ETA. El comercio las activa/opta en su panel.';
CREATE INDEX IF NOT EXISTS idx_shipping_zones_active
  ON public.shipping_zones(active, position);

-- ---------------------------------------------------------------------------
-- Opt-in del comercio: qué zonas extendidas ofrece (precio del catálogo,
-- override opcional si el comercio quiere cobrar más — nunca menos de la
-- tarifa real del catálogo en v1, se valida en la API).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendor_ship_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  shipping_zone_id uuid NOT NULL REFERENCES public.shipping_zones(id) ON DELETE CASCADE,
  fee_override numeric(10, 2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, shipping_zone_id)
);
COMMENT ON TABLE public.vendor_ship_zones IS
  'Zonas extendidas activadas por un comercio. fee_override NULL = precio del catálogo.';
CREATE INDEX IF NOT EXISTS idx_vendor_ship_zones_vendor
  ON public.vendor_ship_zones(vendor_id) WHERE active = true;

-- ---------------------------------------------------------------------------
-- Envíos físicos: 1 pedido = 1 envío (UNIQUE order_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  shipping_zone_id uuid REFERENCES public.shipping_zones(id) ON DELETE SET NULL,
  shipping_zone_name text,
  -- Público y legible (oblea/QR): ENV-ABC123 (único, regenerable sin romper
  -- el tracking porque /envio/[code] usa COALESCE del más nuevo).
  code text NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','picked_up','in_transit','delivered','failed_attempt','returned','cancelled')),
  note text,
  failed_reason text,
  pod_photo_url text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id),
  UNIQUE (code)
);
COMMENT ON TABLE public.shipments IS
  'Encargos de envío extendido a logística partner. 1 por pedido (mismo pedido = mismo paquete). Estados propios de la logística; el pedido mapea picked_up/in_transit→sent, delivered→completed.';
CREATE INDEX IF NOT EXISTS idx_shipments_vendor
  ON public.shipments(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_shipments_carrier
  ON public.shipments(carrier_id, status);

-- updated_at (mismo patrón que orders.updated_at / customers).
DROP TRIGGER IF EXISTS trg_shipments_updated_at ON public.shipments;
CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Timeline del tracking (pública vía /envio/[code] — sin datos del comprador)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  photo_url text,
  -- NULL si lo registró el sistema (alta del envío).
  operator_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.shipment_events IS
  'Timeline de tracking del envío (estados de la logística). Se expone público por /envio/[code]: nunca contiene datos personales del comprador.';
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment
  ON public.shipment_events(shipment_id, created_at);

-- ---------------------------------------------------------------------------
-- Operadores de logística: profiles vinculados a un carrier (login normal
-- de usuario; /envios resuelve su carrier por esta tabla).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carrier_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, carrier_id)
);
COMMENT ON TABLE public.carrier_operators IS
  'Usuarios operadores de una logística partner (login normal del portal; se resuelve su carrier aquí). Un operador puede cubrir más de un carrier.';

-- ---------------------------------------------------------------------------
-- Pedido: referencia de la zona extendida elegida (denormalizado nombre).
-- El fee de envío sigue viajando en orders.delivery_fee (misma columna).
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_zone_id uuid,
  ADD COLUMN IF NOT EXISTS shipping_zone_name text;
COMMENT ON COLUMN public.orders.shipping_zone_id IS
  'Zona extendida del catálogo del portal elegida en el checkout (migración portal-shipments).';
COMMENT ON COLUMN public.orders.shipping_zone_name IS
  'Nombre denormalizado de la zona extendida (sobrevive al borrado de la zona).';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_shipping_zone') THEN
    ALTER TABLE public.orders ADD CONSTRAINT fk_orders_shipping_zone
      FOREIGN KEY (shipping_zone_id) REFERENCES public.shipping_zones(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Detección rápida de pedidos con zona extendida (checkout/mostrador).
CREATE INDEX IF NOT EXISTS idx_orders_shipping_zone
  ON public.orders (shipping_zone_id) WHERE shipping_zone_id IS NOT NULL;

-- Backfill: pedidos viejos con envío pedido (si hubo data manual) no tocan;
-- el código de envío se genera al crear el shipment, no acá.
