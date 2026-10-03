-- ============================================================================
-- Estética — giftcards (v1: códigos con saldo, venta y canje manual en panel).
-- ----------------------------------------------------------------------------
-- - giftcards: código único por tarjeta (ej. EST-XXXXXX), monto original,
--   saldo, clienta opcional, estado y vencimiento opcional.
-- - giftcard_moves: historial de canjes (kind='redeem') con nota
--   (ej. "turno 2026-10-05", "pack Depi x8").
-- La venta se cobra por caja/MP aparte (acá solo se emite el código con
-- saldo); el canje descuenta saldo y deja historial.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-giftcards.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.giftcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  amount numeric(10, 2) NOT NULL DEFAULT 0,
  balance numeric(10, 2) NOT NULL DEFAULT 0,
  customer_name text,
  customer_phone text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'void')),
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_giftcards_vendor ON public.giftcards(vendor_id);
CREATE INDEX IF NOT EXISTS idx_giftcards_code ON public.giftcards(code);

CREATE TABLE IF NOT EXISTS public.giftcard_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giftcard_id uuid NOT NULL REFERENCES public.giftcards(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'redeem' CHECK (kind IN ('redeem', 'adjust')),
  amount numeric(10, 2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_giftcard_moves_card ON public.giftcard_moves(giftcard_id);
