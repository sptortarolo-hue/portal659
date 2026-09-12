-- Opt-out de venta online por comercio (gastro o moda sin carrito).
-- accepts_online_orders: false = el micrositio muestra solo contacto
-- (WhatsApp) aunque el plan traiga carrito; los badges y el filtro online
-- lo respetan; POST /api/orders lo bloquea. Default true (sin cambios).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-online-toggle.sql

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS accepts_online_orders boolean NOT NULL DEFAULT true;
