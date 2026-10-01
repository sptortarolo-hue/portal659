-- Switch "exigir caja abierta para cobrar": con el flag prendido, el
-- Mostrador y el cierre de mesa rechazan cobrar sin turno abierto (409
-- shift_required). Default apagado: operatoria igual que antes.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-require-shift.sql

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS require_open_shift boolean NOT NULL DEFAULT false;
