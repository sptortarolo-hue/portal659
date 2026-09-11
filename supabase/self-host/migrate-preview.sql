-- Modo prueba / preview compartible de micrositios.
-- Un comercio oculto (visible = false) puede verse con token de preview
-- sin aparecer en home/buscar/mapa/sitemap. La publicación la aprueba el admin.
-- Pedidos de prueba: orders.is_preview = true (no cuentan en topes/métricas).

-- Token secreto del link de preview (regenerable/revocable por el dueño).
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS preview_token text;
-- Expiración opcional del token (NULL = sin expiración).
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS preview_token_expires_at timestamptz;
-- Solicitud de publicación pendiente de aprobación del admin.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS publish_requested_at timestamptz;

-- Pedidos hechos en modo prueba: funcionan igual pero no contaminan producción.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_preview boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_vendor_preview_created
  ON orders (vendor_id, is_preview, created_at DESC);

COMMENT ON COLUMN public.vendors.preview_token IS
  'Token secreto del link de preview compartible. NULL = sin preview compartido.';
COMMENT ON COLUMN public.vendors.publish_requested_at IS
  'Solicitud de publicación pendiente de aprobación del admin. NULL = sin solicitud.';
COMMENT ON COLUMN public.orders.is_preview IS
  'Pedido de prueba (modo preview). true = no cuenta en topes/métricas/ingresos.';
