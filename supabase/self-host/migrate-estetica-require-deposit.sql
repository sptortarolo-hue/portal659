-- ============================================================================
-- Estética — seña obligatoria por servicio ("si no paga, no reserva").
-- ----------------------------------------------------------------------------
-- - services.require_deposit: el turno online nace pendiente de pago.
-- - services.deposit_hours: horas para pagar antes de auto-cancelar (24).
-- El cron de booking-reminders (cada 15 min) cancela los impagos vencidos.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-require-deposit.sql
-- ============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS require_deposit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_hours int NOT NULL DEFAULT 24;
