-- migrate-tv-remote.sql
-- Pantalla TV: URL corta por pantalla + mando a distancia (celular -> tele).
--
-- 1) `short_code`: codigo corto de 4 caracteres (p. ej. "k7f2") para que en la
--    tele no haya que escribir la URL de 58 chars. La ruta /t/<code> redirige
--    a la carta. Se genera desde la app (lazy) con indice UNIQUE.
--
-- 2) `remote_command` + `remote_at`: "mando a distancia". El celular escanea
--    el QR y le pide a la tele que muestre una pantalla; el server escribe el
--    comando y el SSE (que ya consulta la DB cada 5s) lo empuja al reproductor.
--
-- Tolerante: sin esta migracion la app sigue funcionando (la carta, el editor,
-- el panel); solo la URL corta y el mando a distancia se apagan (503 con un
-- mensaje que nombra este archivo).

ALTER TABLE public.tv_screens
  ADD COLUMN IF NOT EXISTS short_code text;
ALTER TABLE public.tv_screens
  ADD COLUMN IF NOT EXISTS remote_command text;
ALTER TABLE public.tv_screens
  ADD COLUMN IF NOT EXISTS remote_at timestamptz;

-- El codigo corto es unico (no puede repetirse entre pantallas).
CREATE UNIQUE INDEX IF NOT EXISTS tv_screens_short_code_idx
  ON public.tv_screens(short_code)
  WHERE short_code IS NOT NULL;

COMMENT ON COLUMN public.tv_screens.short_code IS
  'Codigo corto (4 chars) para la URL /t/<code> que se tipea en el televisor. Se genera en la app.';
COMMENT ON COLUMN public.tv_screens.remote_command IS
  'Ultimo comando remoto: token de la pantalla a la que la tele debe cambiar. Lo consume el SSE.';
COMMENT ON COLUMN public.tv_screens.remote_at IS
  'Momento del ultimo comando remoto: el SSE lo compara para no repetirlo.';
