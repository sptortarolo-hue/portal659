-- Piloto del bot de pedidos por WhatsApp (add-on del plan Gestión).
-- Guarda el vínculo de un comercio con su número/relay del APK "Portal Wa Link".
-- Vendors tras el piloto: DROP TABLE vendor_wa_bots; (borrado total, ver docs/piloto-whatsapp-bot.md).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-pilot-whatsapp-bot.sql

CREATE TABLE IF NOT EXISTS public.vendor_wa_bots (
  vendor_id   uuid PRIMARY KEY REFERENCES public.vendors(id) ON DELETE CASCADE,
  wa_phone    text,
  status      text NOT NULL DEFAULT 'unlinked', -- 'unlinked' | 'linked'
  enabled     boolean NOT NULL DEFAULT false,   -- kill switch por comercio (toggle admin)
  token       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_wa_bots_enabled ON public.vendor_wa_bots (enabled);