-- ============================================================================
-- Estética — carta estilo apps (categorías + equipo con foto).
-- ----------------------------------------------------------------------------
-- - services.category: rubro (Uñas, Pestañas, Cejas...). NULL = sin rubro.
-- - estetica_staff.photo_url / bio: ficha del profesional en el micrositio.
-- Sin esto la carta sale plana y el equipo solo con nombres.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-service-menu.sql
-- ============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.estetica_staff
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS bio text;

CREATE INDEX IF NOT EXISTS idx_services_vendor_category ON public.services(vendor_id, category);
