-- ============================================================================
-- Vertical "taller" — Talleres y Reparaciones (híbrido venta + servicio):
-- bicicleterías, servicio técnico de celulares y electrodomésticos, gomerías,
-- reparación de calzado y todo lo que se repara en el barrio. Misma
-- maquinaria que estética (carrito, mostrador, turnera, presupuestos con
-- partidas, seña MP/Stripe, packs), con copy de "Presupuestos".
-- ----------------------------------------------------------------------------
-- Solo agrega 'taller' al CHECK de vendors.vertical. Sin datos ni tablas
-- nuevas (el vertical reusa las de estética: services, estetica_staff,
-- estetica_blocks, service_packs, quote_items, etc.).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-taller-vertical.sql
-- ============================================================================

ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_vertical_check;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'estetica', 'taller', 'varios', 'mascotas', 'otro'));
