-- Fiado / cuenta corriente de clientes (mostrador).
-- Ledger append-only por teléfono: charge (venta fiada) y payment (pagos,
-- manuales o por link de MP). Saldo = Σcharges − Σpayments.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiado.sql

CREATE TABLE IF NOT EXISTS public.account_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('charge', 'payment')),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  ref_order uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_moves_vendor_phone ON public.account_moves(vendor_id, customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_moves_order ON public.account_moves(ref_order) WHERE ref_order IS NOT NULL;
