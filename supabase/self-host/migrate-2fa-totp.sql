-- ============================================================
-- 2FA TOTP para admins (ver src/lib/totp.ts).
-- Columnas nuevas en profiles:
--   totp_secret     : secreto TOTP cifrado AES-256-GCM (iv.tag.data), deriva
--                     la clave de JWT_SECRET. NULL = no configurado.
--   totp_enabled    : true solo después de verificar el primer código.
--   totp_last_step  : último paso de tiempo (30s) aceptado — anti-replay.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-2fa-totp.sql
--
-- Rollback manual si un admin queda bloqueado (perdió el autenticador):
--   UPDATE profiles SET totp_enabled = false, totp_secret = NULL,
--                      totp_last_step = NULL
--   WHERE email = '<email>';
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS totp_enabled boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS totp_last_step bigint;

-- Sin índice extra: la consulta es por id (PK), no por totp_enabled.