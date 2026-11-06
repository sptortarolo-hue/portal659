-- ============================================================================
-- Ficha de equipo (talleres / reparaciones): bicicletas, motos, electrodomésticos.
-- ----------------------------------------------------------------------------
-- Tabla equipment por comercio + referencia opcional desde quotes y bookings.
-- Campos: kind, brand, model, identifier (n° cuadro/serie), rodado, color,
-- notas y datos del cliente (redundantes de propósito: el historial por
-- equipo vive con el teléfono, aunque el turno/presupuesto también tenga
-- nombre). El dedupe de carga online: mismo (vendor, phone, identifier) se
-- reutiliza (índice único parcial).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-equipment.sql
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'bici' CHECK (kind IN ('bici', 'moto', 'automotor', 'electro', 'otro')),
  brand text,
  model text,
  identifier text,          -- N° de cuadro / serie
  rodado text,              -- medida de rueda (bicis) u ojalá modelo (electro)
  color text,
  notes text,
  customer_name text,
  customer_phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_vendor ON public.equipment(vendor_id);
CREATE INDEX IF NOT EXISTS idx_equipment_vendor_phone ON public.equipment(vendor_id, customer_phone);
-- Dedupe: mismo equipo (por serie) cargado online/manualmente se reutiliza.
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_unique_serie
  ON public.equipment(vendor_id, customer_phone, identifier)
  WHERE identifier IS NOT NULL AND identifier <> '';

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS equipment_id uuid REFERENCES public.equipment(id) ON DELETE SET NULL;
