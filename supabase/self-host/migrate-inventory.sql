-- Módulo Inventario compartido (comercio, gastro, moda; lectura para servicio).
-- Listas de precios por proveedor, costo de mercadería, conteos físicos y
-- kardex append-only. Todo aditivo e idempotente; no toca flujos existentes.
-- - supplier_pricelists: precio por proveedor × (insumo|producto|variante).
-- - products.cost_last/cost_avg + variants.cost_last: último y promedio.
-- - stock_counts + lines: conteo físico con snapshot del sistema.
-- - stock_ledger: kardex (compra|venta|conteo|merma|devolucion|manual|apartado).
-- - Flag "inventory":true en planes gestion y oficios (oficios lo usa solo
--   para leer proveedores/precios al cotizar; sin UI de stock).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-inventory.sql

-- Costo de mercadería (comercio/moda). NULL = sin costo.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_last numeric(12,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_avg numeric(12,2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS cost_last numeric(12,2);

-- Lista de precios por proveedor (exactamente un target por fila).
CREATE TABLE IF NOT EXISTS public.supplier_pricelists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  price numeric(12,4) NOT NULL,
  unit text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricelist_one_target CHECK (
    num_nonnulls(ingredient_id, product_id, variant_id) = 1
  )
);
CREATE INDEX IF NOT EXISTS idx_pricelists_vendor ON public.supplier_pricelists(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pricelists_supplier ON public.supplier_pricelists(supplier_id);
CREATE INDEX IF NOT EXISTS idx_pricelists_product ON public.supplier_pricelists(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pricelists_variant ON public.supplier_pricelists(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pricelists_ingredient ON public.supplier_pricelists(ingredient_id) WHERE ingredient_id IS NOT NULL;

-- Conteos físicos de inventario.
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'abierto',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_stock_counts_vendor ON public.stock_counts(vendor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE SET NULL,
  system_qty numeric NOT NULL DEFAULT 0,
  counted_qty numeric,
  note text
);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON public.stock_count_lines(count_id);

-- Kardex append-only (auditoría de movimientos).
CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE SET NULL,
  qty_delta numeric NOT NULL,
  reason text NOT NULL,
  ref_order uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ref_purchase uuid REFERENCES public.purchases(id) ON DELETE SET NULL,
  ref_count uuid REFERENCES public.stock_counts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_vendor ON public.stock_ledger(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_product ON public.stock_ledger(product_id, created_at DESC) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_ledger_variant ON public.stock_ledger(variant_id, created_at DESC) WHERE variant_id IS NOT NULL;

-- Líneas de mercadería en compras: la tabla original exige ingredient_id.
ALTER TABLE public.purchase_items ALTER COLUMN ingredient_id DROP NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_items_product ON public.purchase_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_items_variant ON public.purchase_items(variant_id) WHERE variant_id IS NOT NULL;

-- Flag inventory en planes con gestión (gestion + oficios).
UPDATE public.plans
SET features = COALESCE(features, '{}'::jsonb) || '{"inventory": true}'::jsonb
WHERE slug IN ('gestion', 'oficios');
