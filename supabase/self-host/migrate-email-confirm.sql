-- ============================================================
-- MIGRACIÓN: confirmación de email en profiles
-- Aplicar en el VPS contra el Postgres de producción (psql/cliente SQL).
-- Es IDEMPOTENTE: se puede correr varias veces sin romper nada.
--
-- Agrega las columnas para el token de confirmación de email,
-- con el mismo patrón que reset_token_hash / reset_token_expires:
--   - confirm_token_hash: sha256 del token (no se guarda el token crudo).
--   - confirm_token_expires: expiración del token (~48h).
-- ============================================================

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS confirm_token_hash text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS confirm_token_expires timestamptz;

COMMIT;
