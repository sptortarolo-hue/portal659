-- Idempotencia del webhook de Mercado Pago: guarda los payment_id ya
-- procesados para que un reintento de MP no cree pedidos/duplicados (ni
-- doble descuento de stock).
CREATE TABLE IF NOT EXISTS public.mp_processed_payments (
  payment_id  text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mp_processed_payments IS
  'Pagos MP ya procesados (webhook approved). Un reintento con el mismo payment_id se descarta.';
