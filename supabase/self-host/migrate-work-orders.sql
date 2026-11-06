-- ============================================================================
-- Órdenes de servicio (recepción de taller): "dejé mi bici y la retiro el
-- martes". Un turno SIN hora ni duración, con fecha de ingreso (hoy) y fecha
-- de entrega estimada, ligado al equipo del cliente (migrate-equipment.sql).
-- ----------------------------------------------------------------------------
-- Modelo: MISMA tabla bookings, rama nueva con kind='orden':
--   - booking_time pasa a NULLABLE (hoy es `time NOT NULL`) y duration_min
--     queda NULL: la orden no ocupa horario (sin solape, sin agenda).
--   - delivery_date: fecha de entrega estimada (sin hora; NULL = a convenir).
--   - work_order_no: numeración CORRIDA por comercio (1, 2, 3... no reinicia
--     por día). UNIQUE por vendor entre órdenes.
--   - declared_issue: falla/trabajo que declara el cliente.
--   - diagnosis: diagnóstico del taller (opcional).
--   - status suma los estados del flujo de taller, TODOS salteables:
--     recibida → diagnosticada → presupuestada → aprobada → en reparación →
--     esperando repuesto → lista → entregada (pending → diagnosed → quoted →
--     approved → repairing → waiting_parts → ready → completed) +
--     cancelled (descartada).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-work-orders.sql
-- Idempotente. Tolerancia: sin aplicar, la app funciona igual y el botón
-- "Nueva orden" no aparece (todo el código pregunta antes por hasColumn).
-- ============================================================================

-- 1) Sin hora obligatoria: la orden no tiene horario.
ALTER TABLE public.bookings ALTER COLUMN booking_time DROP NOT NULL;

-- 2) Rama orden de servicio.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'turno';
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_kind_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_kind_check CHECK (kind IN ('turno', 'orden'));

-- 3) Datos propios de la orden.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS delivery_date date,
  ADD COLUMN IF NOT EXISTS work_order_no integer,
  ADD COLUMN IF NOT EXISTS declared_issue text,
  ADD COLUMN IF NOT EXISTS diagnosis text;

-- 4) Estados del flujo de taller (se saltan libremente desde el panel).
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'diagnosed', 'quoted', 'approved', 'repairing', 'waiting_parts', 'ready', 'confirmed', 'completed', 'noshow', 'cancelled'));

-- 5) Numeración corrida por comercio (única entre órdenes).
CREATE UNIQUE INDEX IF NOT EXISTS bookings_work_order_no_unique
  ON public.bookings (vendor_id, work_order_no) WHERE kind = 'orden' AND work_order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_kind_idx ON public.bookings (vendor_id, kind);

-- 6) Comentarios de documentación.
COMMENT ON COLUMN public.bookings.kind IS 'turno = cita con hora; orden = recepción de taller (sin hora, con fecha de entrega)';
COMMENT ON COLUMN public.bookings.delivery_date IS 'Orden: fecha de entrega estimada (sin hora). NULL = a convenir.';
COMMENT ON COLUMN public.bookings.work_order_no IS 'Orden: número corrido por comercio (1, 2, 3...).';
COMMENT ON COLUMN public.bookings.declared_issue IS 'Orden: falla/trabajo que declara el cliente.';
COMMENT ON COLUMN public.bookings.diagnosis IS 'Orden: diagnóstico del taller.';
