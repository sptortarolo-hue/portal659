-- Canje de giftcards en pedidos (checkout online + mostrador).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-giftcard-redeem.sql

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS giftcard_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS giftcard_discount numeric(12, 2) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_orders_giftcard ON public.orders(vendor_id, giftcard_code) WHERE giftcard_code IS NOT NULL;
