-- Visibilidad de la carta QR (/carta/[slug]), independiente del micrositio.
-- `qr_only` (default) = solo entra quien tiene el link/QR: no se linkea desde
-- el micrositio, no indexa (robots noindex) y no entra al sitemap.
-- `public` = se linkea desde el micrositio ("Ver carta"), indexa y va al sitemap.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-carta-visibility.sql
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS carta_visibility text NOT NULL DEFAULT 'qr_only'
  CHECK (carta_visibility IN ('public', 'qr_only'));

-- Comercios ya publicados mantienen su menú en el micrositio (nada cambia
-- para ellos hasta que elijan "Solo QR" en Configuración → Carta y QR).
UPDATE public.vendors SET carta_visibility = 'public'
WHERE visible = true AND carta_visibility = 'qr_only';
