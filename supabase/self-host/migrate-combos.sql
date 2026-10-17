-- ============================================================================
-- Combos de productos (v1): un combo es un producto vendible propio
-- (nombre, foto, precio, promo) con líneas de componentes (product_id + qty).
-- ----------------------------------------------------------------------------
-- - combo_items: miembros del combo. La existencia de filas con
--   combo_product_id = p.id es lo que hace a p un combo (sin columna extra).
-- - FK ON DELETE CASCADE: borrar el combo borra sus líneas; borrar un
--   componente deja el combo (el GET filtra miembros que ya no existen).
-- - El stock del combo se gestiona por componentes (adjustStockForItems).
-- - Sin migración adicional: combo_items se lee/escribe dentro de transacciones.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-combos.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.combo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  combo_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  member_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_combo_item_member UNIQUE (combo_product_id, member_product_id)
);
CREATE INDEX IF NOT EXISTS idx_combo_items_combo ON public.combo_items(combo_product_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_member ON public.combo_items(member_product_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_vendor ON public.combo_items(vendor_id);
