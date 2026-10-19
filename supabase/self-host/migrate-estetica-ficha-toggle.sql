-- ============================================================================
-- Estética — interruptor global de ficha por recordatorio.
-- ----------------------------------------------------------------------------
-- vendors.ficha_reminder_enabled: si está en false, el recordatorio T-24 NO
-- incluye el link de la ficha (útil para los modelos con require_before=false
-- o para comercios que prefieren mandarla a mano). Default true => igual que
-- hoy (solo se adjuntaba si el modelo tenía require_before = true).
--
-- Idempotente. Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-ficha-toggle.sql
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS ficha_reminder_enabled boolean NOT NULL DEFAULT true;
