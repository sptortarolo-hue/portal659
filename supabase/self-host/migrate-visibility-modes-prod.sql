-- Visibilidad de 3 estados para comercios (producción sin columna `visible`)
-- hidden  = oculto (solo preview con token)
-- private = micrositio funcional sin listar en portal
-- public  = visible en portal (home/buscar/mapa/sitemap)

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'hidden'
  CHECK (visibility IN ('hidden', 'private', 'public'));

-- Backfill: en producción no existe `visible`, así que todo queda 'hidden' por defecto
-- (el admin cambiará a 'public' o 'private' según corresponda)
UPDATE public.vendors
SET visibility = 'hidden'
WHERE visibility IS NULL;

-- Índice para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_vendors_visibility ON public.vendors (visibility);

COMMENT ON COLUMN public.vendors.visibility IS
  'Visibilidad del comercio: hidden=oculto (solo preview), private=micrositio funcional sin listar, public=visible en portal';