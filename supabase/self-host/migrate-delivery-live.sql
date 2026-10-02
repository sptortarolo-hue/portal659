-- migrate-delivery-live.sql
-- Georeferencia en vivo del repartidor (punto actual, sin historial ni ruta).
--
--   - orders.courier_lat/lng: última posición reportada por el repartidor
--     (POST /api/vendor/orders/[id]/position con watchPosition del celu).
--   - orders.courier_updated_at: cuándo se reportó (el cliente ve
--     "actualizado hace Xs"; si es viejo se muestra aviso).
--
-- Privacidad: solo tiene valor mientras status='sent' (En camino). Al pasar
-- a completed/cancelled el PATCH las nulifica. El track público
-- (/api/orders/track/[token]) solo las expone en 'sent'.
-- Sin PostGIS: dos doubles alcanzan para el punto vivo barrial.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS courier_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS courier_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS courier_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.courier_lat IS
  'Última latitud reportada por el repartidor (solo viva en status sent).';
COMMENT ON COLUMN public.orders.courier_lng IS
  'Última longitud reportada por el repartidor (solo viva en status sent).';
COMMENT ON COLUMN public.orders.courier_updated_at IS
  'Cuándo se reportó la última posición del repartidor.';

CREATE INDEX IF NOT EXISTS orders_courier_updated_idx
  ON public.orders (courier_updated_at)
  WHERE courier_lat IS NOT NULL;
