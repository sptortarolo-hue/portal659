-- QR de vinculación del bot de WhatsApp, guardado en Postgres (no depende de Redis/Upstash).
-- El relay (celular) genera el QR; el cerebro lo guarda acá y /api/wa/qr lo lee para
-- mostrarlo en el panel del comercio. TTL por antigüedad (90s), no por tarea.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-wa-qr.sql

ALTER TABLE public.vendor_wa_bots ADD COLUMN IF NOT EXISTS qr_data text;
ALTER TABLE public.vendor_wa_bots ADD COLUMN IF NOT EXISTS qr_updated_at timestamptz;