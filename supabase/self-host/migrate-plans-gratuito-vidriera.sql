-- migrate-plans-gratuito-vidriera.sql
-- Nuevo alcance del plan Gratuito ("vidriera + contacto", ver /planes):
--   - SIN carrito ni pedidos online: vender por la app arranca en Básico ($pedidos).
--   - Hasta 10 productos o servicios publicados en la vidriera.
--   - SIN turnos ni presupuestos online (solo contacto por WhatsApp).
--
-- Los comercios YA ACTIVOS en Gratuito no pierden nada: se los pasa a la fila
-- histórica `gratuito_legacy`, congelada con los valores vigentes de `gratuito`
-- (carrito + topes anteriores). El código en `src/lib/plans.ts` reconoce ese
-- slug y resuelve sus features/topes desde la fila (grandfathering).
--
-- NO se tocan PRECIOS (los define el admin en /admin/planes y son la fuente
-- de verdad en VPS).
--
-- Correr en el contenedor (el archivo vive en el HOST):
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < supabase/self-host/migrate-plans-gratuito-vidriera.sql

-- Columnas de tope (idempotente; tolerante si falta alguna migración previa).
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_orders_month integer;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_quotes_month integer;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_screens integer;

-- 1) Fila histórica: copia EXACTA del gratuito vigente ANTES del cambio.
--    sort = 99: queda al final en el admin; no se muestra en /planes ni como
--    opción contratable en /vendor/suscripcion.
INSERT INTO public.plans
  (id, slug, name, description, price_monthly, max_products, max_orders_month,
   max_quotes_month, max_screens, features, badge, popular, sort)
SELECT gen_random_uuid(),
       'gratuito_legacy',
       'Gratuito (modelo anterior)',
       d.description,
       d.price_monthly,
       d.max_products,
       d.max_orders_month,
       d.max_quotes_month,
       d.max_screens,
       d.features,
       d.badge,
       d.popular,
       99
  FROM public.plans d
 WHERE d.slug = 'gratuito'
   AND NOT EXISTS (SELECT 1 FROM public.plans WHERE slug = 'gratuito_legacy');

-- 2) Los comercios gratuitos ACTUALES pasan al modelo congelado.
--    (plan_id IS NULL también: son anteriores al cambio.)
UPDATE public.vendors
   SET plan_id = (SELECT id FROM public.plans WHERE slug = 'gratuito_legacy')
 WHERE plan_id = (SELECT id FROM public.plans WHERE slug = 'gratuito')
    OR plan_id IS NULL;

-- 3) Nuevo Gratuito: vidriera sin carrito, 10 productos, sin pedidos ni
--    solicitudes online. (max_orders_month / max_quotes_month = 0: sin
--    cupo; el API rechaza y el micrositio oculta los formularios.)
UPDATE public.plans
   SET max_products = 10,
       max_orders_month = 0,
       max_quotes_month = 0,
       description = 'Vidriera de tu barrio: hasta 10 productos o servicios + contacto directo por WhatsApp. Sin carrito ni pedidos online.',
       features = (features - 'cart' - 'emits_orders')
                  || '{"cart": false, "emits_orders": false}'::jsonb
 WHERE slug = 'gratuito';
