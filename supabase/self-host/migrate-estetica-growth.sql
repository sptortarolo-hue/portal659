-- ============================================================================
-- Estética — crecimiento: lista de espera, reseñas Google, fidelización.
-- ----------------------------------------------------------------------------
-- - waitlist: "avisame si se libera" (no bloquea agenda; el comercio contacta).
-- - vendors.google_review_url: link a reseñas de Google del local.
-- - vendors.loyalty_every / loyalty_pct: cada N sesiones, % off manual.
-- - customers.last_winback_at: último "te extrañamos" (anti-spam 45 días).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-growth.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  service_id uuid REFERENCES public.services(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.estetica_staff(id) ON DELETE SET NULL,
  booking_date date NOT NULL,
  booking_time time,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waitlist_vendor_date ON public.waitlist(vendor_id, booking_date);

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS google_review_url text,
  ADD COLUMN IF NOT EXISTS loyalty_every int,
  ADD COLUMN IF NOT EXISTS loyalty_pct numeric(5, 2);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_winback_at timestamptz;

-- Log de pedido de reseña post-visita (una vez por turno).
CREATE TABLE IF NOT EXISTS public.service_review_log (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);
