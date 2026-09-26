-- ============================================================
-- Notas de Crédito C: asocian la NC con su factura original.
-- cbte_tipo distingue (11 factura, 13 nota de crédito); asoc_* solo
-- tienen valor en NC (NULL = comprobante original).
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-nc.sql
-- ============================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS asoc_tipo integer,
  ADD COLUMN IF NOT EXISTS asoc_pto integer,
  ADD COLUMN IF NOT EXISTS asoc_nro bigint;

CREATE INDEX IF NOT EXISTS idx_invoices_asoc
  ON public.invoices (vendor_id, asoc_pto, asoc_nro)
  WHERE asoc_nro IS NOT NULL;

-- La NC comparte order_id con su factura: el UNIQUE pasa a cubrir solo
-- originales (una factura por pedido; las NC van con asoc_*).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_vendor_order_unique;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_vendor_order_unique
  ON public.invoices (vendor_id, order_id) WHERE cbte_tipo = 11;
