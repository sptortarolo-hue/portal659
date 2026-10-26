-- ============================================================================
-- Estética - devolución de la seña al cancelar el turno (editable por comercio)
-- ----------------------------------------------------------------------------
-- vendors.cancel_refunds_deposit: decides qué pasa con la seña pagada cuando
-- la clienta cancela dentro del plazo (cancel_hours, default 24):
--   true  (default) = se devuelve,
--   false           = se retiene (el comercio la avisa antes de reservar y en
--                    el flujo de cancelación de /turno/[token]).
--
-- Es la contracara editable de "Si el cliente no viene" (noshow_policy), que
-- hoy sólo retiene. Default true = comportamiento histórico (sin retención).
--
-- Idempotente. Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cancel-deposit-refund.sql
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS cancel_refunds_deposit boolean NOT NULL DEFAULT true;
