-- Módulo Compras (fase Compras v1, estilo Fudo base) — gastronomía.
-- Proveedores + compras con comprobante + líneas que actualizan el costo
-- del insumo al ÚLTIMO precio neto (los platos se recalculan solos porque
-- el costo es derivado). Solo precios, SIN stock ni cuenta corriente.
-- Cada purchase_items es un punto del historial de precios del insumo.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-purchases.sql

-- ============================================================
-- PROVEEDORES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_vendor ON public.suppliers(vendor_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_vendor_active ON public.suppliers(vendor_id, active);

-- ============================================================
-- COMPRAS (cabecera)
-- receipt_type: Factura A/B/C, Remito, Ticket o ninguno.
-- total: suma de líneas (lo calcula la API, no se edita a mano).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  -- SET NULL: el proveedor puede borrarse sin perder el historial.
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  purchased_at date NOT NULL DEFAULT CURRENT_DATE,
  receipt_type text NOT NULL DEFAULT 'ninguno'
    CHECK (receipt_type IN ('factura_a', 'factura_b', 'factura_c', 'remito', 'ticket', 'ninguno')),
  receipt_number text,
  notes text,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor ON public.purchases(vendor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_vendor_date ON public.purchases(vendor_id, purchased_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier ON public.purchases(supplier_id);

-- ============================================================
-- LÍNEAS DE COMPRA
-- qty/unit: cantidad comprada en la unidad de la línea (ej. 1 'kg').
-- unit_cost_net: costo NETO (sin IVA) por UNIDAD BASE del insumo
--   (ej. $/g). Es el valor que pisa ingredients.cost_per_unit.
-- line_total: qty_en_base * unit_cost_net.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  -- RESTRICT: no se puede borrar un insumo con historial de compras
  -- (igual que recipe_items), para no romper costos en silencio.
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  qty numeric(12, 4) NOT NULL CHECK (qty > 0),
  unit text NOT NULL DEFAULT 'g',
  unit_cost_net numeric(12, 4) NOT NULL CHECK (unit_cost_net >= 0),
  line_total numeric(12, 2) NOT NULL DEFAULT 0,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_ingredient ON public.purchase_items(ingredient_id);
-- Historial de precios por insumo (más reciente primero).
CREATE INDEX IF NOT EXISTS idx_purchase_items_ingredient_date ON public.purchase_items(ingredient_id, created_at DESC);
