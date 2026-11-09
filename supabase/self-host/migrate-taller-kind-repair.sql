-- ============================================================================
-- Reparación: órdenes de servicio mal clasificadas como TURNO.
-- ----------------------------------------------------------------------------
-- Síntoma: una orden de taller (recepción de un equipo, sin hora) aparece en
-- la pestaña "Turnos" / "Turnos por confirmar" en lugar del tablero "Taller".
--
-- Causa: `bookings.kind` tiene DEFAULT 'turno'. Cualquier fila que se haya
-- creado sin la columna `kind` explícita (o antes de aplicar
-- migrate-work-orders.sql) queda como turno aunque tenga datos de orden.
--
-- Criterio: solo se re-clasifica como orden la fila que
--   - está marcada como turno, y
--   - tiene al menos un dato propio de una orden de servicio
--     (número de orden, falla declarada o fecha de entrega).
-- No se exige "sin hora": una orden vieja pudo quedar con `booking_time`
-- cargado, y esas eran justo las que seguían apareciendo en Turnos.
-- Es idempotente: correrla dos veces no cambia nada.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-taller-kind-repair.sql
-- ============================================================================

DO $$
DECLARE
  fixed integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'kind'
  ) THEN
    RAISE NOTICE 'bookings.kind no existe: aplicar migrate-work-orders.sql primero.';
    RETURN;
  END IF;

  UPDATE public.bookings
     SET kind = 'orden'
   WHERE kind = 'turno'
     AND (
       work_order_no IS NOT NULL
       OR declared_issue IS NOT NULL
       OR delivery_date IS NOT NULL
     );

  GET DIAGNOSTICS fixed = ROW_COUNT;
  RAISE NOTICE 'Órdenes de servicio re-clasificadas: %', fixed;
END $$;

-- Verificación rápida (no falla, solo muestra el estado):
--   SELECT kind, COUNT(*) FROM bookings GROUP BY kind;
