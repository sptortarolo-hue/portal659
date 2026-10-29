-- ============================================================
-- Cobro parcial de cuenta de mesa (estilo Fudo).
-- Permite cobrar una mesa por monto libre o por consumiciones
-- (con cantidad parcial), reduciendo el saldo pendiente hasta 0.
-- Cada pago parcial en efectivo genera un movimiento de caja
-- (ingreso) para el cierre Z.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.table_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'efectivo'
    CHECK (payment_method IN ('efectivo', 'transferencia', 'tarjeta', 'mixto', 'whatsapp')),
  kind text NOT NULL DEFAULT 'amount'
    CHECK (kind IN ('amount', 'items')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_table_payments_table ON public.table_payments(table_id);
CREATE INDEX IF NOT EXISTS idx_table_payments_vendor ON public.table_payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_table_payments_created ON public.table_payments(created_at);

-- Columna para rastrear el saldo cobrado en la orden de mesa (tolerante
-- a migración sin aplicar: el backend la consulta por information_schema).
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN amount_paid numeric(12, 2) NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;