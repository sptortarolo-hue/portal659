-- ============================================================================
-- Vertical Estética v1: turnera por servicio + profesional (una sede),
-- seña opcional por servicio, packs de sesiones, ficha extendida.
-- ----------------------------------------------------------------------------
-- - vendors.vertical += 'estetica' (nuevo vertical propio, híbrido turnera +
--   productos; 'salud' queda legacy).
-- - vendors.cancel_policy_text / cancel_hours (default 24h): política visible
--   en el micrositio y validada al cancelar.
-- - services: catálogo de servicios con duración + buffer + seña propia.
-- - estetica_staff: profesionales del local (agenda por profesional; v1 solo
--   atribución, sin comisiones; distinto de vendor_staff de reparto).
-- - bookings: staff_id / service_id / starts_at / ends_at (solape),
--   deposit_amount / deposit_status / mp_payment_id (seña opcional en turnos;
--   quotes ya la tiene por migrate-service-oficios.sql).
-- - service_packs + service_pack_credits: packs de sesiones con contador.
-- - customers: allergies / skin_notes / consent_at (ficha + consentimiento).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica.sql
-- ============================================================================

-- Vertical propio.
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_vertical_check;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'estetica', 'varios', 'mascotas', 'otro'));

-- Política de cancelación configurable por comercio.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS cancel_policy_text text,
  ADD COLUMN IF NOT EXISTS cancel_hours int NOT NULL DEFAULT 24;

-- Catálogo de servicios de estética (duración + buffer + seña propia).
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_min int NOT NULL DEFAULT 60,
  buffer_min int NOT NULL DEFAULT 0,
  deposit_amount numeric(10, 2),
  active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_services_vendor ON public.services(vendor_id);

-- Profesionales del local (agenda por profesional; v1 atribución).
CREATE TABLE IF NOT EXISTS public.estetica_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estetica_staff_vendor ON public.estetica_staff(vendor_id);

-- Turno: profesional + servicio + rango real (solape) + seña opcional.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.estetica_staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'none'
    CHECK (deposit_status IN ('none', 'pending', 'paid')),
  ADD COLUMN IF NOT EXISTS mp_payment_id text;
CREATE INDEX IF NOT EXISTS idx_bookings_vendor_staff ON public.bookings(vendor_id, staff_id, starts_at);

-- Packs de sesiones (v1: venta manual en panel + descuento por turno).
CREATE TABLE IF NOT EXISTS public.service_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  sessions_total int NOT NULL DEFAULT 1,
  price numeric(10, 2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_packs_vendor ON public.service_packs(vendor_id);

CREATE TABLE IF NOT EXISTS public.service_pack_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.service_packs(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  remaining int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, customer_phone)
);
CREATE INDEX IF NOT EXISTS idx_pack_credits_vendor_phone
  ON public.service_pack_credits(vendor_id, customer_phone);

-- Ficha cliente extendida (alergias/piel + consentimiento digital).
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS allergies text,
  ADD COLUMN IF NOT EXISTS skin_notes text,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz;
