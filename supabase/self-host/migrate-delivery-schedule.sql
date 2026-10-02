-- migrate-delivery-schedule.sql
-- Franjas de reparto para retail (moda + comercio): el cliente sabe cuándo
-- le llega el pedido y puede elegir entre los próximos 3 turnos.
--
--   - vendors.delivery_hours: franjas de reparto en el mismo formato del
--     HoursEditor ("lun: 09:00-13:00 y 17:00-22:00"). NULL = "mismo horario
--     del local" (default, cero fricción: el comercio no configura nada).
--   - vendors.delivery_prep_min: base empaquetado+reparto retail (default 60).
--     Separado de prep_time_min (gastro): retail ni lo ve ni lo edita.
--   - orders.delivery_window: turno prometido elegido por el cliente, texto
--     denormalizado ("mañana 09:00–13:00"). Sobrevive a cambios de horario y
--     sirve para ticket/WhatsApp/seguimiento/historial.
--
-- Fuera de horario NO se bloquea: el pedido entra con el próximo turno
-- (aviso amable en checkout + alternativa de retiro). Sin cupo por turno
-- en esta versión.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS delivery_hours text,
  ADD COLUMN IF NOT EXISTS delivery_prep_min integer NOT NULL DEFAULT 60;
COMMENT ON COLUMN public.vendors.delivery_hours IS
  'Franjas de reparto retail (formato HoursEditor). NULL = mismo horario del local.';
COMMENT ON COLUMN public.vendors.delivery_prep_min IS
  'Base empaquetado+reparto retail en minutos (default 60). Separado de prep_time_min gastro.';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_window text;
COMMENT ON COLUMN public.orders.delivery_window IS
  'Turno de entrega prometido elegido por el cliente ("mañana 09:00–13:00"). Denormalizado.';
