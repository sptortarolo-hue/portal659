-- Vinculo order <-> cobro de MP la pantalla de vuelta del checkout
-- puede encontrar el pedido por payment_id sin depender del teléfono ni del
-- sessionStorage del cliente (que muere si MP vuelve por app de pago).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mp_payment_id text;

CREATE INDEX IF NOT EXISTS idx_orders_mp_payment_id
  ON public.orders(mp_payment_id) WHERE mp_payment_id IS NOT NULL;
