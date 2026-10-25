-- ============================================================================
-- Estética - servicio "Oferta del día" (destacado hoy), igual que los
-- productos tienen products.featured_today.
-- ----------------------------------------------------------------------------
-- services.featured_today: un solo servicio destacado por comercio (el server
-- enforcea la exclusividad: al marcar uno, apaga los demás del mismo vendor).
-- Se usa para:
--   - flotar el servicio primero en la carta del micrositio (ORDER BY
--     featured_today DESC) con badge "Hoy" (bg-sun, mismo estilo que productos),
--   - alimentar la sección "La oferta de hoy" del home (carrousel mixto, uno
--     por comercio).
--
-- Idempotente. Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-service-featured.sql
-- ============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS featured_today boolean NOT NULL DEFAULT false;
