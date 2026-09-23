-- ============================================================
-- kitchen_strict_close: on/off del cierre estricto de cocina.
-- true (default) = para marcar "Listo" hay que tildar todos los ítems
-- en la Comanda (también frena a Pedidos/Mesas, el gate es server-side).
-- false = se puede avanzar sin tildar (hora pico / modo confianza).
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-kitchen-strict.sql
-- ============================================================
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS kitchen_strict_close boolean NOT NULL DEFAULT true;
