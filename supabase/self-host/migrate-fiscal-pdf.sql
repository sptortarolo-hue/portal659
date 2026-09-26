-- ============================================================
-- PDF del comprobante fiscal (generado bajo demanda, no en cada emisión).
-- pdf_url: ruta pública bajo UPLOAD_DIR (ej. fiscal/<vendor>/C-....pdf).
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-pdf.sql
-- ============================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pdf_url text;
