-- ============================================================
-- Cache persistente del TA de WSAA (token+sign) por CUIT y entorno.
--
-- Por qué: WSAA no emite un segundo ticket mientras haya uno vigente
-- (fault "El CEE ya posee un TA valido", hasta 12 h). El cache en memoria
-- se pierde en cada deploy/reinicio y deja al comercio en un loop de
-- fallos. Persistido en DB, el portal reutiliza el ticket tras reinicios.
-- Token y sign se guardan CIFRADOS (misma llave que los certificados).
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-ta-cache.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS public.fiscal_ta_cache (
  env text NOT NULL,
  cuit text NOT NULL,
  service text NOT NULL DEFAULT 'wsfe',
  token text NOT NULL,
  sign text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (env, cuit, service)
);
