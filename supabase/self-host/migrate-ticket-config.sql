-- Configuración de ticket / impresión térmica.
-- Toggles por línea de dato en el encabezado de todos los documentos impresos.
-- Por defecto todo activado; nombre del comercio y pie de página siempre se imprimen.

-- Imprimir logo del comercio en el encabezado (redondo, junto al nombre).
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS print_logo boolean NOT NULL DEFAULT true;

-- Mostrar dirección en el encabezado.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS print_address boolean NOT NULL DEFAULT true;

-- Mostrar teléfono / WhatsApp en el encabezado.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS print_phone boolean NOT NULL DEFAULT true;

-- Mostrar redes sociales (Instagram / Facebook) en el encabezado.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS print_social boolean NOT NULL DEFAULT true;