-- Llave en mano: visibilidad publica de comercios en el portal.
-- `visible = true` = el comercio aparece en home/buscar/mapa/micrositio.
-- `visible = false` (default) = oculto hasta que el admin lo muestre.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT false;

-- No romper lo existente: los comercios ya publicados quedan visibles.
UPDATE public.vendors SET visible = true WHERE verified = true;

COMMENT ON COLUMN public.vendors.visible IS
  'Control de visibilidad publica (llave en mano). true = visible en el portal.';