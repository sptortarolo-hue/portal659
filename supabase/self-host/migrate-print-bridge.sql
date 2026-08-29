-- ============================================================
-- MIGRACIÓN: impresión térmica vía app puente (Portal Print)
-- Aplicar contra el Postgres de producción (psql en el contenedor).
-- IDEMPOTENTE.
-- ============================================================
BEGIN;

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS print_mode text NOT NULL DEFAULT 'server';
COMMENT ON COLUMN public.vendors.print_mode IS
  'Modo de impresión: server = TCP directo desde el VPS; app = vía app puente (Portal Print) en la red local';

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS print_token text;
COMMENT ON COLUMN public.vendors.print_token IS
  'Token único que la app puente usa para conectarse al relay del vendor';

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS last_print_at timestamptz;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS last_print_ok boolean;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS last_print_error text;

COMMIT;