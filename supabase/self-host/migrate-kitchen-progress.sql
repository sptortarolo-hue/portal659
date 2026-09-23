-- ============================================================
-- kitchen_done: progreso de cocina por ítem (comanda acumulativa).
-- Guarda un array JSON de booleanos paralelo a orders.items:
--   [true, false, ...] = ítem tildado / pendiente en el KDS.
-- NULL o '[]' = nada tildado (pedidos viejos). El server lo
-- normaliza al largo de items al leer/escribir.
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-kitchen-progress.sql
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS kitchen_done jsonb NOT NULL DEFAULT '[]'::jsonb;
