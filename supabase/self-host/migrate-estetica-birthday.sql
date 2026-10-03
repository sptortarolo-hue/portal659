-- ============================================================================
-- Estética — cumpleaños de clientas (recordatorio manual con WhatsApp).
-- ----------------------------------------------------------------------------
-- - customers.birthdate: fecha de nacimiento (se usa día+mes; el año es
--   opcional pero se guarda igual con tipo date).
-- El panel muestra próximos cumpleaños (30 días) con acceso directo a
-- WhatsApp. Sin envíos automáticos en v1 (el portal no envía WhatsApp).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-birthday.sql
-- ============================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS birthdate date;
