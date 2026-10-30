-- migrate-tv-screens.sql
-- Pantalla TV (carta digital): cada comercio puede tener hasta `max_screens`
-- pantallas mostrando su carta en un TV, en la ruta pública /pantalla/[token].
--
-- Modelo híbrido:
--   - `draft`    : lo que edita el comercio en el panel (nunca ve la TV).
--   - `published`: snapshot CONGELADO de configuración que ve la TV.
--   - los contenidos vivos (nombres, precios, fotos, agotados) NO se copian:
--     se leen del catálogo en cada request, así un cambio de precio se
--     refleja en segundos sin "publicar" (publicar solo manda el layout).
--
-- Tolerante: toda la app funciona sin la migración (las APIs de vendor
-- responden 503 nombrando este archivo, y /pantalla devuelve 404 amable).

CREATE TABLE IF NOT EXISTS public.tv_screens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id      uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  -- 'menu'   = carta (este sprint); 'orders' = turnero de pedidos listos (después).
  kind           text NOT NULL DEFAULT 'menu' CHECK (kind IN ('menu', 'orders')),
  name           text NOT NULL DEFAULT 'Pantalla 1',
  token          text NOT NULL UNIQUE,
  draft          jsonb NOT NULL DEFAULT '{}'::jsonb,
  published      jsonb,
  -- Bump en cada publish: el SSE lo compara para disparar la recarga en el TV.
  version        integer NOT NULL DEFAULT 0,
  published_at   timestamptz,
  -- Heartbeat de la TV (POST /api/pantalla/[token]/ping): "pantalla conectada".
  last_seen_at   timestamptz,
  client_version text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tv_screens_vendor_idx ON public.tv_screens(vendor_id);
CREATE INDEX IF NOT EXISTS tv_screens_token_idx ON public.tv_screens(token);

-- Feature de plan: la Pantalla TV es exclusiva del plan Gestión integral.
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_screens integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.plans.max_screens IS
  'Cantidad máxima de pantallas TV por comercio. 0 = plan sin Pantalla TV.';

UPDATE public.plans SET max_screens = 2 WHERE slug = 'gestion';

-- La feature viaja en el JSONB de features (patrón del resto de las features).
-- Apta por defecto solo Gestión integral, para que el admin pueda encenderla
-- puntualmente en cualquier plan desde /admin.
UPDATE public.plans SET features = features || '{"screens": true}'::jsonb WHERE id = '6f000000-0000-4000-8000-000000000003';
UPDATE public.plans SET features = features - 'screens' WHERE id <> '6f000000-0000-4000-8000-000000000003';
