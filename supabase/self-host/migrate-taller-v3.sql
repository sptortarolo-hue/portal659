-- ============================================================================
-- Vertical taller v3: ficha de orden completa (job card).
-- ----------------------------------------------------------------------------
-- 1) `bookings.intake_checklist` jsonb — checklist de ingreso OPCIONAL y
--    genérico (bicicletería, electrónica, electrodomésticos, hogar):
--    { accessories: string[], other?: string, unlock?: string, condition?: string }.
--    Vacío/NULL = la sección no se muestra.
-- 2) `bookings.diagnosis` text — diagnóstico del técnico (editable en la ficha).
-- 3) `bookings.labor_amount` numeric — mano de obra cobrada (costo/margen).
-- 4) `work_order_parts` — repuestos usados en la orden (integración Inventario):
--    al insertar se descuenta stock (ajuste aparte en la app) y queda snapshot
--    de costo/precio para el margen.
-- 5) `booking_events` — event feed por orden (cada cambio queda registrado).
-- 6) `stock_ledger.ref_booking` — el kardex puede apuntar a la orden.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-taller-v3.sql
-- Idempotente. Sin aplicar: checklist/repuestos/feed se ignoran con error
-- claro (503 en el endpoint que los usa); el tablero y el ABM siguen igual.
-- ============================================================================

-- 1) Checklist de ingreso (opcional).
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS intake_checklist jsonb;

-- 2) Diagnóstico.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS diagnosis text;

-- 3) Mano de obra.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS labor_amount numeric(12,2);

-- 4) Repuestos usados en la orden.
CREATE TABLE IF NOT EXISTS public.work_order_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  qty numeric(10,2) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_order_parts_booking
  ON public.work_order_parts(booking_id);
CREATE INDEX IF NOT EXISTS idx_work_order_parts_vendor
  ON public.work_order_parts(vendor_id, created_at DESC);

-- 5) Event feed por orden.
CREATE TABLE IF NOT EXISTS public.booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note'
    CHECK (kind IN ('created','status','diagnosis','quote_linked','quote_sent',
                    'quote_approved','parts','payment','signature','extended','note')),
  message text NOT NULL DEFAULT '',
  actor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking
  ON public.booking_events(booking_id, created_at DESC);

-- 6) Kardex: referencia opcional a la orden de servicio.
ALTER TABLE public.stock_ledger
  ADD COLUMN IF NOT EXISTS ref_booking uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bookings.intake_checklist IS 'Checklist de ingreso opcional (accesorios, contraseña/patrón, estado al recibir). NULL/vacío = sin checklist.';
COMMENT ON COLUMN public.bookings.diagnosis IS 'Diagnóstico del técnico (orden de servicio).';
COMMENT ON COLUMN public.bookings.labor_amount IS 'Mano de obra cobrada en la orden (taller).';
COMMENT ON TABLE public.work_order_parts IS 'Repuestos usados en una orden de servicio (taller). Snapshot de costo/precio; el stock se ajusta en la app.';
COMMENT ON TABLE public.booking_events IS 'Event feed de una orden/turno: cada cambio relevante queda registrado (taller).';
