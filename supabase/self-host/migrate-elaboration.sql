-- Módulo "Envasado" (granel → paquetes) — comercio de barrio.
-- Caso de uso: el comercio compra granel (20 kg de nueces), envasa paquetes
-- de peso variable con la balanza, cada paquete lleva etiqueta (Envasado) y
-- descuenta stock de insumo (granel + packaging) y suma stock de paquetes
-- del producto terminado.
--
-- Aditivo e idempotente; no toca columnas existentes.
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-elaboration.sql
-- Sin esta migración: la pantalla Envasado responde 503 nombrando el archivo,
-- el selector de "Controlar stock" de insumos no aparece y el resto del
-- panel funciona igual.

-- ============================================================
-- INSUMOS: stock contable (en unidad base: g / ml / u).
-- NULL = sin control de stock (comportamiento histórico: los insumos
-- solo llevaban costo). Numeric porque el granel se pesa con decimales.
-- ============================================================
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS stock numeric(14, 3);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredients_stock_nonneg') THEN
    ALTER TABLE public.ingredients
      ADD CONSTRAINT ingredients_stock_nonneg CHECK (stock IS NULL OR stock >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.ingredients.stock IS
  'Stock actual en unidad base (g/ml/u). NULL = insumo sin control de stock (solo costo, como siempre).';

-- ============================================================
-- PRODUCTOS: stock por PAQUETES (la columna products.stock integer queda
-- intacta: en productos envasados cuenta paquetes, no kilos ni unidades).
-- count_pack: el terminado "cuenta bolsas" (una etiqueta = 1 paquete).
-- package_price: precio fijo del paquete para la venta online
--   (NULL = sin venta online de paquetes).
-- ============================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS count_pack boolean NOT NULL DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS package_price numeric(10, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_package_price_nonneg') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_package_price_nonneg CHECK (package_price IS NULL OR package_price >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.products.count_pack IS
  'true = producto envasado: stock_control + unit kg pero el stock se lleva por PAQUETES (integer). Una etiqueta (un escaneo) = 1 paquete.';
COMMENT ON COLUMN public.products.package_price IS
  'Precio fijo del paquete para venta online (NULL = no se vende online por paquete). La etiqueta de balanza sigue cobrando por kg.';

-- ============================================================
-- LOTES DE ENVASADO: resumen de cada corrida (trazabilidad básica,
-- reportes y verificación del costo real del paquete).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.packing_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  units int NOT NULL CHECK (units > 0),
  total_kg numeric(12, 3) NOT NULL DEFAULT 0 CHECK (total_kg >= 0),
  -- Costo total del lote (consumo real: pesaje + merma del granel + packaging).
  cost_total numeric(12, 2) NOT NULL DEFAULT 0,
  -- Costo por paquete del lote (cost_total / units).
  cost_per_unit numeric(12, 4) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_packing_batches_vendor ON public.packing_batches(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_packing_batches_product ON public.packing_batches(product_id, created_at DESC);

-- ============================================================
-- Kardex: suma la razón 'envasado' (no hay CHECK sobre reason, pero
-- se documenta). Salidas de insumo: qty_delta < 0; entrada del terminado:
-- qty_delta > 0 con reason 'envasado'.
-- ============================================================
COMMENT ON COLUMN public.stock_ledger.reason IS
  'compra|venta|conteo|merma|devolucion|manual|apartado|orden|envasado';
