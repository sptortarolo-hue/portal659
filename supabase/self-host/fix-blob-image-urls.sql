-- Limpieza de fotos con URL temporal (blob:/data:) guardadas en `vendors`.
--
-- Contexto: al recortar una foto desde el panel (Config → Foto del comercio /
-- Logo) se guardaba el `previewUrl` del navegador, que es una URL `blob:...`
-- que NO existe en el servidor. Consecuencia: la foto se veía rota en el
-- micrositio y la tarjeta de WhatsApp (og:image) salía sin la foto del local
-- (el render no puede bajarse un blob: y caía al fallback).
--
-- El fix de código (ya aplicado) sube el archivo recortado y guarda la URL
-- real de /uploads, y el API ahora rechaza URLs que no sean http(s).
-- Este script limpia los que quedaron guardados: se vacían (NULL) para que
-- el comercio vuelva a subir la foto desde el panel y no se vea una imagen
-- rota.
--
-- Aplicar en el VPS:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/fix-blob-image-urls.sql

-- 1) Diagnóstico: qué comercios quedaron con URL temporal.
SELECT id, store_name, slug, image_url, logo_url
  FROM vendors
 WHERE image_url LIKE 'blob:%' OR image_url LIKE 'data:%'
    OR logo_url  LIKE 'blob:%' OR logo_url  LIKE 'data:%';

-- 2) Limpieza: las fotos con URL temporal no se pueden recuperar (eran
--    referencias a un blob del navegador que ya no existe).
UPDATE vendors SET image_url = NULL
 WHERE image_url LIKE 'blob:%' OR image_url LIKE 'data:%';

UPDATE vendors SET logo_url = NULL
 WHERE logo_url LIKE 'blob:%' OR logo_url LIKE 'data:%';

-- 3) Comprobación: no debería quedar ninguna.
SELECT count(*) AS quedan_urls_temporales
  FROM vendors
 WHERE image_url LIKE 'blob:%' OR image_url LIKE 'data:%'
    OR logo_url  LIKE 'blob:%' OR logo_url  LIKE 'data:%';
