-- Modo "Se coordina": el horario de entrega se arregla por WhatsApp.
-- La zona y la tarifa siguen visibles; solo se ocultan horarios/turnos.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-delivery-coordinar.sql

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS delivery_coordinar boolean NOT NULL DEFAULT false;
