-- ============================================================================
-- Configuración global del portal (clave → valor), editable desde /admin:
--   wa_float = true|false  → botón flotante de WhatsApp del portal
--                            (contacto 221 201 0898) en todo el sitio público.
-- Default con tabla ausente (migración pendiente): wa_float = true, o sea el
-- botón se muestra — mismo comportamiento que antes de existir el switch.
--
-- Aplicar contra el contenedor (el archivo vive en el HOST):
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < supabase/self-host/migrate-portal-settings.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.portal_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO portal_settings (key, value) VALUES ('wa_float', 'true'::jsonb)
  ON CONFLICT (key) DO NOTHING;
