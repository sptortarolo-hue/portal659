-- Seguimiento público de pedidos: token único por pedido para el link
-- que se incluye al final del mensaje de WhatsApp del pedido.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS track_token text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_track_token
  ON public.orders(track_token)
  WHERE track_token IS NOT NULL;

-- Backfill de pedidos existentes (gen_random_uuid es core en PG13+).
UPDATE public.orders
SET track_token = md5(gen_random_uuid()::text || random()::text)
WHERE track_token IS NULL;