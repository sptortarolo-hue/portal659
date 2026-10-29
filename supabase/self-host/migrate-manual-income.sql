-- ============================================================
-- Ingresos manuales (packs de sesiones y giftcards vendidas por caja):
-- registra el medio de pago para que aparezcan en el cierre de caja (Z)
-- por medio de pago, igual que orders/bookings.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-manual-income.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.manual_income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pack', 'giftcard')),
  ref_id uuid,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'efectivo',
  note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_income_vendor_date
  ON public.manual_income (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_income_vendor_kind
  ON public.manual_income (vendor_id, kind);
