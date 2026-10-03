-- ============================================================================
-- Estética — productos utilizados por turno (ficha de la clienta).
-- ----------------------------------------------------------------------------
-- - bookings.products_used: texto libre con los insumos aplicados en el
--   servicio (ej. "Tinte Koleston 7/0 + oxidante 20v, botox capilar").
--   Lo carga el comercio en el panel (turno confirmado); se muestra en el
--   historial de la ficha del cliente.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-products-used.sql
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS products_used text;
