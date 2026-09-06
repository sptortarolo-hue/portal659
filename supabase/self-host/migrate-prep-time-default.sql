-- Control de demora (tiempo de preparación): default 30 min y nunca null.
-- Antes el toggle podía quedar off (prep_time_min = NULL); ahora siempre tiene valor.
UPDATE public.vendors
SET prep_time_min = 30
WHERE prep_time_min IS NULL;

-- Blindaje: si algún insert/reset vuelve a dejarlo NULL, defaultDB a 30.
ALTER TABLE public.vendors
ALTER COLUMN prep_time_min SET DEFAULT 30;