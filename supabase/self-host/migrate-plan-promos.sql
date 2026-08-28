-- Sprint: Gestión de planes y promociones.
-- Agrega campos de promoción a la tabla `plans`:
--   - promo_price   : precio mensual promocional para nuevos suscriptores (por mes)
--   - promo_months  : cantidad de meses de la promo cobrados por adelantado
--   - promo_ends_at : fecha límite de la oferta (opcional; si es NULL o pasada, la promo no se muestra)
--   - promo_label   : texto opcional del badge de la promoción
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS promo_price numeric(10,2),
  ADD COLUMN IF NOT EXISTS promo_months integer,
  ADD COLUMN IF NOT EXISTS promo_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS promo_label text;
