-- ============================================================================
-- Estética — foto por servicio (carta visual estilo apps de belleza).
-- ----------------------------------------------------------------------------
-- - services.image_url: foto del servicio (se muestra en la carta del
--   micrositio y en el picker de reserva).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-service-photo.sql
-- ============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS image_url text;
