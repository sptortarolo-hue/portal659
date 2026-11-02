-- migrate-mp-qr.sql
-- Órdenes de cobro por QR interoperable de Mercado Pago (presencial).
-- Vinculadas a una venta ya registrada (mostrador/mesa/turno/consulta).
-- Sin esta migración los endpoints responden 503 y el botón QR no aparece.

CREATE TABLE IF NOT EXISTS public.mp_qr_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  concept text,
  mp_order_id text,
  external_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled')),
  payment_id text,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mp_qr_orders_vendor_idx ON public.mp_qr_orders(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mp_qr_orders_order_idx ON public.mp_qr_orders(order_id);
CREATE INDEX IF NOT EXISTS mp_qr_orders_status_idx ON public.mp_qr_orders(status, expires_at);

-- Columna opcional en orders para vincular al QR (tolerante: se detecta por information_schema).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS mp_qr_order_id uuid REFERENCES public.mp_qr_orders(id) ON DELETE SET NULL;

-- Toggle de emisión automática de comprobante fiscal al cobrar con QR MP.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS fiscal_auto_emit boolean NOT NULL DEFAULT false;