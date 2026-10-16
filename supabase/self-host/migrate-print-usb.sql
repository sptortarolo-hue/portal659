-- ============================================================
-- MIGRACIÓN: tercer modo de impresión USB por cable (agente PC)
-- Aplicar contra el Postgres de producción (psql en el contenedor).
-- IDEMPOTENTE. Solo documenta el valor 'usb' en vendors.print_mode:
--   server = TCP directo desde el VPS;
--   app    = vía app/agente puente, destino TCP 9100 en la red local;
--   usb    = vía agente PC puente, destino cola USB de Windows (spooler RAW)
--          de la PC donde está enchufada la impresora (por-equipo, el nombre
--          de la cola vive solo en agent.config.json, no en esta tabla).
-- La columna ya es text sin CHECK, así que 'usb' entra sin ALTER de tipo.
-- ============================================================
BEGIN;

COMMENT ON COLUMN public.vendors.print_mode IS
  'Modo de impresión: server = TCP directo desde el VPS; app = vía app/agente puente a TCP 9100 en red local; usb = vía agente PC a cola USB de Windows (spooler RAW) de esa PC';

COMMIT;
