-- ============================================================================
-- Stripe Connect — cobros online a la cuenta del comercio (alternativa a MP).
-- ----------------------------------------------------------------------------
-- - vendors.stripe_account_id (acct_..., no es secreto) + stripe_connected_at.
--   Los direct charges usan la SECRET del portal + header Stripe-Account, así
--   que NO se guardan tokens por comercio.
-- - quotes.stripe_session_id / bookings.stripe_session_id: última Checkout
--   Session de seña (el webhook la matchea por metadata, esto es auditoría).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-stripe-connect.sql
-- ============================================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connected_at timestamptz;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS stripe_session_id text;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stripe_session_id text;
