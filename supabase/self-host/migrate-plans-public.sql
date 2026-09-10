-- migrate-plans-public.sql
-- Alinea la página pública /planes (que se arma 100% de la tabla `plans`)
-- con el modelo propuesto en docs/planes-portal659.md:
--   - Gratuito:  $0, carta completa + carrito/checkout, hasta 20 pedidos/mes.
--   - Pedidos:   $4.990, pedidos ilimitados + analytics 7 días + reseñas.
--   - Gestión:   $12.990, pedidos ilimitados + POS/Mesas/KDS/impresión + cobro online.
-- Las features y límites (max_products/max_orders_month/analytics) ya estaban bien;
-- solo se corrigen precio y descripciones legibles.

-- Gratuito: descripción legible coherente con carta completa (ilimitado) + carrito.
UPDATE public.plans
SET description = 'Carta completa con carrito y pedidos online. Hasta 20 pedidos por mes.'
WHERE slug = 'gratuito';

-- Pedidos: precio y descripción del modelo de precios actual.
UPDATE public.plans
SET price_monthly = 4990,
    description = 'Pedidos ilimitados por la app con avisos, estadísticas de 7 días y gestión de reseñas.'
WHERE slug = 'pedidos';

-- Gestión integral: precio y descripción con el alcance real (incluye cobro online).
UPDATE public.plans
SET price_monthly = 12990,
    description = 'Gestión integral: pedidos ilimitados, comanda, impresión, mostrador, mesas y cobro online con Mercado Pago.'
WHERE slug = 'gestion';