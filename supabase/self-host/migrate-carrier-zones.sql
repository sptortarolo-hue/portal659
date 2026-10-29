-- ============================================================
-- Portal 659 Envíos v2 (bis) — la logística define sus zonas y precios.
--
-- Hasta ahora shipping_zones era un catálogo global del portal (el admin
-- creaba zonas y asignaba una logística). Ahora la logística (o el
-- repartidor independiente) puede crear/editar/borrar sus propias zonas
-- y su tarifa por envío; el admin también puede hacerlo.
--
-- carrier_fee pasa a vivir en shipping_zones (lo cobra la logística al
-- local al retirar). carrier_zone_rates queda como fallback tolerante
-- para no romper lo que ya se cargó.
-- ============================================================

-- 1) Tarifa de la logística directamente en la zona (fuente primaria).
ALTER TABLE public.shipping_zones ADD COLUMN IF NOT EXISTS carrier_fee numeric(10,2);

-- 2) Quién creó la zona (auditoría / scope). NULL = portal/admin.
ALTER TABLE public.shipping_zones ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 3) Índice por carrier para listar "mis zonas" rápido.
CREATE INDEX IF NOT EXISTS idx_shipping_zones_carrier ON public.shipping_zones(carrier_id);

-- 4) Backfill: si había tarifas en carrier_zone_rates, copiarlas a la zona.
UPDATE public.shipping_zones z
   SET carrier_fee = r.fee
  FROM public.carrier_zone_rates r
 WHERE r.shipping_zone_id = z.id
   AND z.carrier_id = r.carrier_id
   AND z.carrier_fee IS NULL;
