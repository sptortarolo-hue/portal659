-- ============================================================
-- MP Multi-Market (OAuth): cada comercio conecta su propia cuenta
-- de Mercado Pago y cobra directo ahí. Tokens cifrados (AES-256-GCM)
-- con MP_TOKEN_KEY — nunca en plano.
-- Correr (desde el host):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-mp-oauth.sql
-- ============================================================
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS mp_user_id bigint;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS mp_access_token text;   -- cifrado
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS mp_refresh_token text;  -- cifrado
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS mp_public_key text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS mp_expires_at timestamptz;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS mp_connected_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_mp_user_id
  ON public.vendors(mp_user_id) WHERE mp_user_id IS NOT NULL;
