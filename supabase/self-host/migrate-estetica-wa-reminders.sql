-- ============================================================================
-- Recordatorios por WhatsApp (P0 ventas): el cron de booking-reminders manda
-- T-24/T-2 por el número del comercio (relay Portal Wa Link) además de push.
-- ----------------------------------------------------------------------------
-- - vendors.wa_reminders: NULL = activado (opt-out); false = solo push.
-- - service_reminder_log.channel: por qué canal salió ('push' | 'wa').
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-wa-reminders.sql
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS wa_reminders boolean;

ALTER TABLE public.service_reminder_log
  ADD COLUMN IF NOT EXISTS channel text;
