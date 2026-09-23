-- Soporte offline vendor, Fase 0 (servidor): idempotencia del sync +
-- hora real de la venta.
--
-- 1) orders.client_key: UUID generado por el cliente, una por acción offline
--    (venta mostrador, consumición, cierre...). UNIQUE(vendor_id, client_key):
--    un reintento del sync tras un timeout devuelve la fila existente en vez
--    de duplicar el pedido (y descontar stock dos veces). NULL en filas
--    legacy: Postgres trata los NULL como distintos, no hay conflicto.
-- 2) orders.occurred_at: momento REAL de la venta/mesa según el dispositivo
--    (lo envía el cliente al sincronizar). created_at/paid_at/closed_at
--    siguen siendo auditoría del servidor (momento de registración).
--    Los reportes comerciales ("ventas de hoy", analytics, día civil del Z)
--    deben usar occurred_at; el arqueo físico usa paid_at.
-- 3) sync_idempotency: log genérico para acciones que NO crean un pedido
--    propio (consumición que mergea en la cuenta abierta, cierre de mesa).
--    Misma semántica: (vendor_id, client_key) único, reintento = respuesta
--    guardada + dedup:true, sin re-ejecutar.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS client_key text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS occurred_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS orders_vendor_client_key
  ON public.orders (vendor_id, client_key);

CREATE TABLE IF NOT EXISTS public.sync_idempotency (
  vendor_id  uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  client_key text NOT NULL,
  action     text NOT NULL,
  order_id   uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  result     jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, client_key)
);

COMMENT ON COLUMN public.orders.client_key IS
  'Clave de idempotencia del sync offline (UUID por acción del cliente). Reintento = fila existente.';
COMMENT ON COLUMN public.orders.occurred_at IS
  'Hora real de la venta según el dispositivo (offline). Reportes comerciales usan esta; created_at/paid_at son registración.';
COMMENT ON TABLE public.sync_idempotency IS
  'Log de idempotencia para acciones offline sin pedido propio (consumición mergeada, cierre de mesa).';
