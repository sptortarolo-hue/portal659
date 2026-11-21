-- Backfill: recalcula cost_last y cost_avg de las presentaciones existentes
-- (productos con parent_id) de forma proporcional al peso, usando el costo
-- de la madre como base.
--
-- Fórmula: costo_hijo = costo_madre × (presentation_qty_hijo / presentation_qty_madre)
--
-- IMPORTANTE: esto pisa cualquier ajuste manual de costo que se haya hecho
-- en una presentación. Si un comercio ya ajustó costos a mano, revisar antes.
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-presentations-backfill-cost.sql
-- ============================================================

UPDATE products c
SET cost_last = round(p.cost_last * (c.presentation_qty / NULLIF(p.presentation_qty, 0)), 2),
    cost_avg  = round(p.cost_avg  * (c.presentation_qty / NULLIF(p.presentation_qty, 0)), 2)
FROM products p
WHERE c.parent_id = p.id
  AND c.cost_last IS NOT NULL
  AND p.cost_last IS NOT NULL
  AND p.presentation_qty IS NOT NULL
  AND p.presentation_qty > 0
  AND c.presentation_qty IS NOT NULL
  AND c.presentation_qty > 0;