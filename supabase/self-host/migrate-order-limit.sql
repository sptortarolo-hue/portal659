-- migrate-order-limit.sql
-- Nuevo modelo de planes (ver docs/planes-portal659.md):
--   - Gratuito: carta completa (productos ilimitados) + carrito/checkout + hasta 20 pedidos/mes.
--   - Pedidos: pedidos ilimitados (sin tope mensual).
--   - Gestión integral: igual + POS/Mesas/KDS/impresión/cobro online.
-- El tope de pedidos aplica solo al canal 'app' (el gratuito no tiene POS/Mesas)
-- y cuenta pedidos del mes calendario (no cancelados).

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_orders_month integer;
COMMENT ON COLUMN public.plans.max_orders_month IS
  'Tope de pedidos (canal app) por mes calendario. NULL = ilimitado.';

-- Gratuito: carta completa + carrito habilitado + tope de 20 pedidos/mes.
UPDATE public.plans
SET max_products = NULL,
    max_orders_month = 20,
    features = features || '{"cart": true, "emits_orders": true}'::jsonb
WHERE slug = 'gratuito';

-- Pedidos: productos ilimitados y sin tope mensual de pedidos.
UPDATE public.plans
SET max_products = NULL,
    max_orders_month = NULL
WHERE slug = 'pedidos';

-- Gestión integral: sin tope mensual de pedidos.
UPDATE public.plans
SET max_orders_month = NULL
WHERE slug = 'gestion';