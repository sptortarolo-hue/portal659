-- Simplificación del circuito retail (moda/comercio): se elimina el paso
-- intermedio "Aceptado" — aceptar lleva directo new → preparing
-- ("Empaquetando"). Este backfill mueve los pedidos que quedaron en
-- 'confirmed' con el flow viejo a 'preparing' para que no queden
-- colgados fuera del Kanban. Idempotente: solo toca status='confirmed'
-- de vendors retail (moda/comercio). updated_at se toca solo si existe
-- la columna (trigger de migrate-orders-updated-at.sql).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-retail-simplify.sql

UPDATE public.orders o
SET status = 'preparing'
FROM public.vendors v
WHERE o.vendor_id = v.id
  AND v.vertical IN ('moda', 'comercio')
  AND o.status = 'confirmed';
