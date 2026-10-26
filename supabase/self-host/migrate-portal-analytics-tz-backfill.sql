-- ============================================================================
-- Backfill de huso horario de la analítica first-party (portal_page_views /
-- portal_events): las filas viejas se guardaron con day = CURRENT_DATE, que en
-- el contenedor de Postgres (UTC) adelantaba la fecha de todo lo ocurrido
-- después de las 21:00 AR. created_at es el timestamptz real del beacon, así
-- que el día correcto se recalcula desde ahí.
--
-- Ejecutar en el VPS (el archivo vive en el HOST):
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < supabase/self-host/migrate-portal-analytics-tz-backfill.sql
--
-- Idempotente: sólo toca filas cuyo day no coincide con el día AR de
-- created_at. En portal_page_views se respeta el UNIQUE (path, device_id, day):
-- si la fila destino ya existe, se borra la duplicada en vez de actualizar.
-- ============================================================================

-- Eventos: sin constraint de unicidad, update directo.
UPDATE portal_events e
   SET day = (e.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
 WHERE e.day <> (e.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;

-- Vistas: borrar primero las que colisionarían con una fila ya existente en
-- el día destino (mismo path + device), y actualizar el resto.
DELETE FROM portal_page_views pv
 WHERE pv.day <> (pv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
   AND EXISTS (
     SELECT 1 FROM portal_page_views x
      WHERE x.path = pv.path
        AND x.device_id = pv.device_id
        AND x.day = (pv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
   );

UPDATE portal_page_views pv
   SET day = (pv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
 WHERE pv.day <> (pv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
