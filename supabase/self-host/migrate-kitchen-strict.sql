-- ============================================================
-- kitchen_strict_close: on/off del cierre estricto de cocina.
-- false (default) = cierre libre: se puede marcar "Listo" sin tildar
-- (hora pico / modo confianza).
-- true = para marcar "Listo" hay que tildar todos los ítems en la
-- Comanda (también frena a Pedidos/Mesas, el gate es server-side).
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-kitchen-strict.sql
-- ============================================================
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS kitchen_strict_close boolean NOT NULL DEFAULT false;
-- El default cambió de true a false: los que quedaron en true por el
-- backfill vuelven a libre (quien lo quiera estricto lo prende en Comanda).
UPDATE public.vendors SET kitchen_strict_close = false WHERE kitchen_strict_close = true;
