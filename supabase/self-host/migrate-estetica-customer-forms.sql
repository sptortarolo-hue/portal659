-- ============================================================================
-- Estética — fichas dinámicas por servicio (modelos + sesiones).
-- ----------------------------------------------------------------------------
-- - customer_form_templates: modelos de ficha del comercio (los campos viven
--   en `fields` jsonb; los presets Masajes/Lifting están en código
--   src/lib/ficha-templates.ts y se instancian con "Crear desde plantilla").
-- - customer_form_entries: cada sesión cargada (fecha + número auto por
--   clienta y modelo), con respuestas, firma y estado borrador/completa.
--   `public_token` permite completarla sin cuenta (/ficha/[token]).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-customer-forms.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.customer_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  service_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  require_before boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_templates_vendor ON public.customer_form_templates(vendor_id);

CREATE TABLE IF NOT EXISTS public.customer_form_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.customer_form_templates(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_no int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'complete')),
  public_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_entries_vendor_phone ON public.customer_form_entries(vendor_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_form_entries_template ON public.customer_form_entries(template_id);
CREATE INDEX IF NOT EXISTS idx_form_entries_booking ON public.customer_form_entries(booking_id);
