-- Pantalla TV en el plan gratuito (F3): growth.
--
-- Da 1 pantalla TV al plan gratuito (los pagos siguen con 2 en gestion) y
-- enciende la feature `screens` en el JSONB del plan gratuito, para que el
-- guard no bloquee a los comercios free. Servicios mantiene la mascara
-- `screens: false` (un plomero no tiene carta de menú).
--
-- Idempotente: se puede correr varias veces.

UPDATE plans
   SET max_screens = 1,
       features = COALESCE(features, '{}'::jsonb) || '{"screens": true}'::jsonb
 WHERE slug = 'gratuito';

-- Asegurar que el plan gestion tenga 2 pantallas (por si la migración base
-- no se aplicó o quedó en null).
UPDATE plans
   SET max_screens = COALESCE(max_screens, 2)
 WHERE slug = 'gestion'
   AND (max_screens IS NULL OR max_screens = 0);

-- El plan gratuito de gastro ya puede usar la TV (1 pantalla).
COMMENT ON COLUMN plans.max_screens IS 'Cantidad máxima de pantallas TV del comercio (0 = sin TV). Gratuito=1, Gestión=2.';