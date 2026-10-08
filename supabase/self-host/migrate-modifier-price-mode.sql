-- Modo de precio por grupo modificador: "diferencia" (default, +$X sobre la
-- base, como siempre) o "total" (cada opción muestra su precio final; solo
-- válido en grupos de selección única, ej. Tamaño). Las opciones pueden
-- traer price_total en el JSONB (ausente = comportamiento actual).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-modifier-price-mode.sql
ALTER TABLE public.modifier_groups ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'diferencia'
  CHECK (price_mode IN ('diferencia', 'total'));
