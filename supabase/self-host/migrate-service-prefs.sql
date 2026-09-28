-- ============================================================================
-- Servicios — preferencias de solicitud (micrositio configurable por comercio).
-- ----------------------------------------------------------------------------
-- - bookings_enabled: muestra u oculta la turnera pública del micrositio.
-- - quote_pref_enabled: muestra u oculta el bloque "días y horario preferidos"
--   del formulario de presupuesto.
-- - quote_days (jsonb): días ofrecidos, ej. ["lun","mar","mie","jue","vie","sab"].
-- - quote_slots (jsonb): franjas ofrecidas, ej. ["mañana","tarde"].
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-service-prefs.sql
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS bookings_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_pref_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_days jsonb NOT NULL DEFAULT '["lun","mar","mie","jue","vie","sab"]'::jsonb,
  ADD COLUMN IF NOT EXISTS quote_slots jsonb NOT NULL DEFAULT '["mañana","tarde"]'::jsonb;
