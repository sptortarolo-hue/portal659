-- ============================================================================
-- Giftcards — emisión automática en la venta (F2 tarjeta de regalo v2).
-- ----------------------------------------------------------------------------
-- - giftcards.order_id/product_id/unit_index: vínculo venta → código(s).
--   UNIQUE parcial (vendor, pedido, producto, unidad) = idempotencia: cobrar
--   dos veces (reintento offline, doble webhook) no duplica códigos.
--   1 código por unidad vendida (decisión de producto).
-- - giftcards.sent_at: marca de entrega al comprador (botón WhatsApp).
-- - giftcard_moves.kind += 'issue': la emisión queda en el historial
--   (activación), igual que el canje (redeem).
-- - Emisiones manuales del panel (order_id NULL) no entran al unique.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-giftcard-issue.sql
-- ============================================================================

ALTER TABLE public.giftcards
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE public.giftcards
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
ALTER TABLE public.giftcards
  ADD COLUMN IF NOT EXISTS unit_index integer;
ALTER TABLE public.giftcards
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_giftcards_order_unit
  ON public.giftcards (vendor_id, order_id, product_id, unit_index)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_giftcards_order
  ON public.giftcards (order_id)
  WHERE order_id IS NOT NULL;

-- El CHECK nació como ('redeem', 'adjust'): se recrea con 'issue'.
ALTER TABLE public.giftcard_moves
  DROP CONSTRAINT IF EXISTS giftcard_moves_kind_check;
ALTER TABLE public.giftcard_moves
  ADD CONSTRAINT giftcard_moves_kind_check
  CHECK (kind IN ('redeem', 'adjust', 'issue'));
