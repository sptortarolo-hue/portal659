-- Módulo Gastos: libro independiente de egresos alimentado desde todas
-- las entradas del sistema (manual + retiros de caja categorizados +
-- compras a proveedor) + carga manual. Con filtros y salidas impresas.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-expenses.sql

-- ============================================================
-- GASTOS
-- source: manual (carga directa) | caja (retiro de caja categorizado)
--   | compra (compra a proveedor registrada en Compras).
-- source_id: id del movimiento/compra origen (NULL en manuales).
-- UNIQUE parcial: un origen genera un solo gasto (anti-duplicados).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('manual', 'caja', 'compra')),
  source_id uuid,
  category text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  spent_at date NOT NULL DEFAULT CURRENT_DATE,
  supplier text,
  note text,
  payment_method text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_source
  ON public.expenses(vendor_id, source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_vendor_date
  ON public.expenses(vendor_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor_category
  ON public.expenses(vendor_id, category);

-- Categoría del movimiento manual de caja (solo retiros alimentan gastos;
-- NULL = no es gasto, ej. "retiro parcial al safe").
ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS category text;
