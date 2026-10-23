-- Proveedor habitual por producto + vencimientos de mercadería.
-- Aditivo e idempotente. No toca flujos existentes.
-- - products.supplier_id: proveedor habitual (se autoasigna al comprar si estaba vacío).
-- - products.expires_at: fecha de vencimiento del stock actual (una por producto).
-- - purchase_items.expires_at: vencimiento informado en cada línea de compra.
-- - vendors.expiry_alert_days: días de aviso anticipado (0 = solo vencidos).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-supplier-expiry.sql

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS expires_at date;
ALTER TABLE public.purchase_items
  ADD COLUMN IF NOT EXISTS expires_at date;
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS expiry_alert_days integer NOT NULL DEFAULT 7;

CREATE INDEX IF NOT EXISTS idx_products_supplier
  ON public.products(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_expires
  ON public.products(vendor_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_items_expires
  ON public.purchase_items(expires_at) WHERE expires_at IS NOT NULL;

COMMENT ON COLUMN public.products.supplier_id IS 'Proveedor habitual del producto (se autoasigna en la primera compra si está vacío).';
COMMENT ON COLUMN public.products.expires_at IS 'Vencimiento del stock actual. Se actualiza al cargar una compra con fecha.';
COMMENT ON COLUMN public.purchase_items.expires_at IS 'Vencimiento informado al comprar esta línea de mercadería.';
COMMENT ON COLUMN public.vendors.expiry_alert_days IS 'Días de aviso anticipado de vencimientos. 0 = avisar solo vencidos.';
