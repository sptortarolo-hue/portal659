-- Giftcards: montos fijos por comercio + idempotencia del webhook MP.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-giftcard-denominations.sql

-- Montos fijos que el comercio ofrece (vacío = monto abierto, legacy estética).
CREATE TABLE IF NOT EXISTS public.giftcard_denominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  active boolean NOT NULL DEFAULT true,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT giftcard_denominations_unique UNIQUE (vendor_id, amount)
);
CREATE INDEX IF NOT EXISTS idx_giftcard_denominations_vendor
  ON public.giftcard_denominations(vendor_id);

-- Idempotencia del webhook: un payment.id emite una sola giftcard aunque
-- Mercado Pago re-notifique (mismo patrón que account_moves mp:).
ALTER TABLE public.giftcards ADD COLUMN IF NOT EXISTS mp_payment_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_giftcards_mp_payment
  ON public.giftcards(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
