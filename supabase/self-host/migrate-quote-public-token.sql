-- ============================================================================
-- Presupuestos: link público de aceptación + seguimiento (/presupuesto/[token])
-- ----------------------------------------------------------------------------
-- Columna:
--   quotes.public_token → token aleatorio único para la página pública.
--   Se genera la primera vez que el comercio comparte por WhatsApp
--   (POST /api/vendor/quotes/[id]/token), no hace falta backfill.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-quote-public-token.sql
-- ============================================================================
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS public_token text;

CREATE UNIQUE INDEX IF NOT EXISTS quotes_public_token_uidx
  ON public.quotes(public_token)
  WHERE public_token IS NOT NULL;

COMMENT ON COLUMN public.quotes.public_token IS 'Token del link público /presupuesto/[token] (aceptar + seguimiento). NULL = todavía no se compartió.';
