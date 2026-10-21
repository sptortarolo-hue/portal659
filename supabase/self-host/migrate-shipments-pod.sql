-- migrate-shipments-pod.sql
-- "Portal 659 Envíos" v2: certificación de entrega + mapa del operador.
--
--   - shipments: destino geocodificado (dest_lat/dest_lng para el mapa del
--     operador) y certificado de entrega estilo Mercado Envíos Flex
--     (quién recibió + DNI + GPS de la entrega). Sin foto del documento
--     (igual que ML: la POD de foto es del paquete/puerta, la identidad va
--     por número de DNI).
--   - geocode_cache: cache de direcciones geocodificadas con Nominatim
--     (evita repetir consultas: 1 req/s de límite y buenas maneras).
--
-- Tolerante: sin aplicar, todo el panel funciona como hoy (sin mapa ni
-- certificado; el POST de entrega no exige DNI si las columnas no existen —
-- la API cae a modo legacy).

-- ---------------------------------------------------------------------------
-- Mapa del operador: donde retirar (vendors.lat/lng ya existe) y donde dejar
-- el paquete (geocodificado de orders.customer_address).
-- ---------------------------------------------------------------------------
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS dest_lat double precision,
  ADD COLUMN IF NOT EXISTS dest_lng double precision;
COMMENT ON COLUMN public.shipments.dest_lat IS
  'Latitud del destino geocodificada (Nominatim, cacheada). NULL = sin geocode aún (el panel muestra el link de Maps).';

-- ---------------------------------------------------------------------------
-- Certificado de entrega (obligatorio al marcar delivered — exigido por la
-- API): quién recibió (nombre) + DNI (solo número, sin foto del documento)
-- + GPS del celular del operador al confirmar.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS delivered_to_name text,
  ADD COLUMN IF NOT EXISTS delivered_dni text,
  ADD COLUMN IF NOT EXISTS delivered_lat double precision,
  ADD COLUMN IF NOT EXISTS delivered_lng double precision,
  ADD COLUMN IF NOT EXISTS delivered_geo_ok boolean;
COMMENT ON COLUMN public.shipments.delivered_to_name IS
  'Nombre de la persona que recibió el paquete (puede no ser el comprador — "recibe otro", igual que Mercado Envíos).';
COMMENT ON COLUMN public.shipments.delivered_dni IS
  'DNI de quien recibió (solo número, sin foto del documento: patrón Mercado Envíos Flex).';
COMMENT ON COLUMN public.shipments.delivered_geo_ok IS
  'true = coordenadas del operador al entregar; false/null = sin geolocalización (permiso denegado). El POST exige GPS salvo cuando la columna no existe (legacy).';
CREATE INDEX IF NOT EXISTS idx_shipments_carrier_open
  ON public.shipments(carrier_id, status) WHERE status NOT IN ('delivered','returned','cancelled');

-- ---------------------------------------------------------------------------
-- Cache de geocoding (Nominatim, 1 req/s: nunca consultar dos veces lo mismo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.geocode_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Clave canónica de la dirección normalizada (minúsculas, sin espacios dobles).
  address_key text NOT NULL,
  lat double precision,
  lng double precision,
  ok boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (address_key)
);
COMMENT ON TABLE public.geocode_cache IS
  'Geocodificación cacheada (Nominatim/OSM). ok=false = la búsqueda no encontró (no reintentar cada request).';
CREATE INDEX IF NOT EXISTS idx_geocode_cache_key ON public.geocode_cache(address_key);
