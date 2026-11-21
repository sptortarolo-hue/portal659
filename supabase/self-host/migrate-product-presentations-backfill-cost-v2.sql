-- Backfill v2: corrige cost_last/cost_avg de presentaciones existentes.
--
-- Problema del v1: las madres (productos raíz) no tenían presentation_qty
-- seteado (NULL), así que el ratio fallaba y solo se actualizaron las que
-- ya tenían qty_madre. Este v2 trata NULL como 1 (la madre es "1 unidad base")
-- y también setea presentation_qty=1 en las madres que tienen hijos pero no
-- tienen qty.
--
-- Fórmula: costo_hijo = costo_madre × (presentation_qty_hijo / COALESCE(presentation_qty_madre, 1))
--
-- IMPORTANTE: esto pisa cualquier ajuste manual de costo que se haya hecho
-- en una presentación. Si un comercio ya ajustó costos a mano, revisar antes.
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-presentations-backfill-cost-v2.sql
-- ============================================================

-- 1. Setear presentation_qty = 1 en las madres que tienen hijos pero no tienen qty.
UPDATE products p
SET presentation_qty = 1
WHERE p.id IN (SELECT DISTINCT parent_id FROM products WHERE parent_id IS NOT NULL)
  AND (p.presentation_qty IS NULL OR p.presentation_qty <= 0);

-- 2. Recalcular costos de las presentaciones proporcionalmente.
UPDATE products c
SET cost_last = round(p.cost_last * (c.presentation_qty / NULLIF(COALESCE(p.presentation_qty, 1), 0)), 2),
    cost_avg  = round(p.cost_avg  * (c.presentation_qty / NULLIF(COALESCE(p.presentation_qty, 1), 0)), 2)
FROM products p
WHERE c.parent_id = p.id
  AND c.cost_last IS NOT NULL
  AND p.cost_last IS NOT NULL
  AND c.presentation_qty IS NOT NULL
  AND c.presentation_qty > 0;