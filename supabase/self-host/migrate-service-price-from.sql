-- ============================================================
-- Precio "Desde $X" / banda para servicios (estética).
-- Mutuamente excluyentes con `price` (fijo): si `price_from` está
-- seteado, `price` queda NULL y el micrositio muestra "Desde $X"
-- (o "Desde $X – Hasta $Y" si `price_to`). El precio final se
-- define al cobrar el turno (cobro actualiza el snapshot).
-- Correr contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-service-price-from.sql
-- ============================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS price_from numeric(10, 2),
  ADD COLUMN IF NOT EXISTS price_to numeric(10, 2);

COMMENT ON COLUMN public.services.price_from IS 'Precio de referencia "desde" (NULL = precio fijo en `price` o consultar)';
COMMENT ON COLUMN public.services.price_to IS 'Tope opcional de la banda "Desde X – Hasta Y" (NULL = solo "Desde X")';
