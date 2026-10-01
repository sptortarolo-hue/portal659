-- Turno de caja: apertura con monto inicial + movimientos manuales de efectivo.
-- El Z (cash_closings) pasa a colgar de un turno cuando lo hay; sin turno
-- abierto, el cierre legacy (período desde último Z) sigue funcionando igual.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-shifts.sql

-- ============================================================
-- TURNOS: una apertura = fondo inicial + responsable + momento.
-- opened_by → profiles (hoy el dueño; mañana staff vía vendor_staff).
-- Un solo turno abierto por comercio (índice único parcial).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  opened_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closing_id uuid REFERENCES public.cash_closings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_shifts_open
  ON public.cash_shifts(vendor_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_cash_shifts_vendor
  ON public.cash_shifts(vendor_id, opened_at DESC);

-- ============================================================
-- MOVIMIENTOS manuales de efectivo dentro del turno (no son ventas):
-- ingresos (fondo extra, cambio) y retiros (proveedor, retiro parcial).
-- Solo afectan al cajón (efectivo); otros medios no tocan la caja.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES public.cash_shifts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('ingreso', 'retiro')),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_shift
  ON public.cash_movements(shift_id, created_at);

-- ============================================================
-- Columnas del turno en el Z (nulables: los cierres legacy anteriores
-- siguen válidos y el ticket los imprime como antes).
-- movements: {"ingresos": N, "retiros": N} — lo calcula la API al cerrar.
-- expected_cash: apertura + ventas efvo (+señas efvo) + ingresos − retiros.
-- ============================================================
ALTER TABLE public.cash_closings
  ADD COLUMN IF NOT EXISTS shift_id uuid REFERENCES public.cash_shifts(id) ON DELETE SET NULL;
ALTER TABLE public.cash_closings
  ADD COLUMN IF NOT EXISTS opening_amount numeric(12, 2);
ALTER TABLE public.cash_closings
  ADD COLUMN IF NOT EXISTS movements jsonb NOT NULL DEFAULT '{"ingresos":0,"retiros":0}'::jsonb;
ALTER TABLE public.cash_closings
  ADD COLUMN IF NOT EXISTS expected_cash numeric(12, 2);
