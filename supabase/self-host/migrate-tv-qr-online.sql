-- ============================================================================
-- QR de pedidos online en la Pantalla TV — interruptor general ENCENDIDO.
--
-- Contexto: el interruptor global `tv_qr_online` se creó apagado por defecto
-- (fail-safe). Eso hacía que el QR NUNCA apareciera: el comercio activaba su
-- switch en la pantalla, publicaba, y no veía nada. Ahora el default del
-- código es true (interruptor de emergencia) y este script deja el estado
-- explícito en la base: queda una fila con true.
--
-- Importante: esto NO habilita el QR en todas las pantallas. Cada pantalla
-- sigue necesitando su propio switch (config.qr.enabled) y que el comercio
-- venda online. Lo único que hace es que el portal no lo bloquee.
--
-- Aplicar contra el contenedor (el archivo vive en el HOST):
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < supabase/self-host/migrate-tv-qr-online.sql
--
-- Es idempotente: se puede correr las veces que quieras.
-- ============================================================================

-- Por si la tabla de configuración global todavía no está en la base.
CREATE TABLE IF NOT EXISTS public.portal_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portal_settings (key, value) VALUES ('tv_qr_online', 'true'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = now();

-- Verificación (devuelve la fila con true):
--   SELECT key, value FROM portal_settings WHERE key = 'tv_qr_online';
