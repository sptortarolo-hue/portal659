-- migrate-mp-qr-direct.sql
-- Flag de venta directa en las órdenes de cobro por QR MP.
-- Permite que, al confirmarse el pago, una venta directa se complete/cierre
-- (no forma pedido con flow), mientras retiro/envío siguen el flow normal.
ALTER TABLE public.mp_qr_orders ADD COLUMN IF NOT EXISTS is_direct boolean NOT NULL DEFAULT false;
