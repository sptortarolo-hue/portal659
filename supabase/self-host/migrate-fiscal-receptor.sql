-- Receptor identificado en comprobantes fiscales (factura con DNI/CUIT).
-- Suma nombre y condición IVA a las columnas receptor_doc_tipo/nro que ya
-- existen (default 99/'0' = consumidor final, sin cambios).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal-receptor.sql

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS receptor_nombre text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS receptor_cond_iva integer;
