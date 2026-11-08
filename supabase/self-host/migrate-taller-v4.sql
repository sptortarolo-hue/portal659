-- ============================================================================
-- Vertical taller v4: presupuestos de consulta sin orden asociada.
-- ----------------------------------------------------------------------------
-- 1) `quotes.booking_id` nullable — referencia opcional a la orden de servicio.
--    Si es NULL, el presupuesto es una "consulta" (cliente preguntó sin traer
--    el equipo aún). Si tiene valor, está vinculado a una orden.
-- 2) `quotes.quote_type` — 'consulta' | 'orden' para distinguir visualmente.
-- 3) Índice para buscar consultas pendientes sin respuesta >48h.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-taller-v4.sql
-- Idempotente.
-- ============================================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS quote_type text
    CHECK (quote_type IN ('consulta', 'orden'))
    DEFAULT 'consulta';

CREATE INDEX IF NOT EXISTS idx_quotes_booking
  ON public.quotes(booking_id);
CREATE INDEX IF NOT EXISTS idx_quotes_type_status
  ON public.quotes(quote_type, status);

COMMENT ON COLUMN public.quotes.booking_id IS 'Orden de servicio vinculada (NULL = presupuesto de consulta sin orden).';
COMMENT ON COLUMN public.quotes.quote_type IS 'Tipo de presupuesto: consulta (sin equipo aún) o orden (vinculado a orden de servicio).';
