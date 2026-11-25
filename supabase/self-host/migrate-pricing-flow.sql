-- Flujo completo compra -> costo -> lista -> precio.
-- Todo tolerante a migración sin aplicar: el código asume defaults.

-- Origen del precio de venta: manual | lista | factura
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS pricing_skipped jsonb NOT NULL DEFAULT '{}'::jsonb;

-- IVA: default "no recupero" (monotributista).
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS iva_recuperable boolean;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS iva_recuperable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_vendor_price_source
  ON public.products (vendor_id, price_source)
  WHERE price_source <> 'manual';
