-- ============================================================================
-- Estética — link público de confirmación de turnos (sin cuenta).
-- ----------------------------------------------------------------------------
-- - bookings.confirm_token: token único por turno para /turno/[token]
--   (la clienta confirma o cancela sin registrarse). Se genera al crear el
--   turno; el backfill cubre turnos viejos.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-estetica-confirm-token.sql
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS confirm_token text UNIQUE;

-- Backfill: turnos viejos sin token.
UPDATE public.bookings
SET confirm_token = encode(gen_random_bytes(16), 'hex')
WHERE confirm_token IS NULL;
