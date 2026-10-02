-- migrate-delivery-schedule-override.sql
-- Override de reparto + días especiales (retail: moda + comercio).
--
--   - vendors.delivery_override: NULL = según horario, true = forzar
--     abierto, false = reparto pausado. La pausa es BLANDA: el pedido sigue
--     entrando con el próximo turno (aviso amable + alternativa de retiro).
--   - vendors.delivery_paused_until: auto-resume (NULL = hasta reanudar a
--     mano; "resto del día" = hoy 23:59). Vencido se trata como NULL
--     (evaluación lazy, sin cron).
--   - vendors.delivery_pause_reason: motivo opcional que el comercio puede
--     mostrar al cliente (saturado | sin_repartidor | cierra_temprano | otro).
--   - vendors.delivery_extra_days: días especiales (extender o agregar),
--     jsonb {"2026-10-04": {"open": "09:00", "close": "23:00"}}.
--     {open,close} reemplaza las franjas del día; {close} solo extiende la
--     última franja (solo si el día tiene horario). Tope +8 días / 7 entradas
--     (se valida en PATCH /api/vendor/me). Fechas pasadas se ignoran.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS delivery_override boolean,
  ADD COLUMN IF NOT EXISTS delivery_paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_pause_reason text,
  ADD COLUMN IF NOT EXISTS delivery_extra_days jsonb NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.vendors.delivery_override IS
  'Override de reparto: NULL=según horario, true=forzar abierto, false=pausado (blando: el pedido entra con el próximo turno).';
COMMENT ON COLUMN public.vendors.delivery_paused_until IS
  'Auto-resume de la pausa (NULL=hasta reanudar a mano). Vencido se ignora.';
COMMENT ON COLUMN public.vendors.delivery_pause_reason IS
  'Motivo opcional de la pausa (saturado|sin_repartidor|cierra_temprano|otro).';
COMMENT ON COLUMN public.vendors.delivery_extra_days IS
  'Días especiales de reparto: {"YYYY-MM-DD": {"open": "HH:MM", "close": "HH:MM"}}. Reemplaza (open+close) o extiende (solo close) las franjas del día.';
