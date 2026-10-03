-- ============================================================================
-- Estética — multi-sede light (v1: sedes como entidades + asignación).
-- ----------------------------------------------------------------------------
-- - estetica_locations: sedes del centro (nombre, dirección, teléfono).
-- - services.location_id / estetica_staff.location_id: sede donde se ofrece
--   el servicio / atiende el profesional (NULL = todas las sedes).
-- - bookings.location_id: sede elegida al reservar (NULL = sin preferencia).
-- Alcance v1: la clienta elige sede al reservar y el panel la muestra; NO
-- hay horarios ni agendas separadas por sede (el control de solape sigue
-- siendo por profesional en todas las sedes).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-locations.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.estetica_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estetica_locations_vendor ON public.estetica_locations(vendor_id);

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.estetica_locations(id) ON DELETE SET NULL;

ALTER TABLE public.estetica_staff
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.estetica_locations(id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.estetica_locations(id) ON DELETE SET NULL;
