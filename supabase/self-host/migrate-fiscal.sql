-- ============================================================
-- Módulo fiscal ARCA (Factura electrónica, v1: Factura C).
-- Exclusivo del plan Gestión integral (feature `fiscal`).
--
-- vendors: datos fiscales por comercio (CUIT, punto de venta
-- electrónico, certificado/clave CIFRADOS, entorno homo/prod).
-- invoices: comprobantes emitidos (1 por pedido, idempotente).
-- Correr (el archivo vive en el host; pasarlo por stdin):
--   cd /opt/portal659 && docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-fiscal.sql
-- ============================================================

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS cuit text,
  ADD COLUMN IF NOT EXISTS fiscal_cond_iva text NOT NULL DEFAULT 'monotributo',
  ADD COLUMN IF NOT EXISTS fiscal_punto_venta integer,
  ADD COLUMN IF NOT EXISTS fiscal_cert text,
  ADD COLUMN IF NOT EXISTS fiscal_key text,
  ADD COLUMN IF NOT EXISTS fiscal_env text NOT NULL DEFAULT 'homo';

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  cbte_tipo integer NOT NULL DEFAULT 11,
  punto_venta integer NOT NULL,
  cbte_nro bigint NOT NULL,
  cae text NOT NULL,
  cae_vto date NOT NULL,
  total numeric(10, 2) NOT NULL,
  receptor_doc_tipo integer NOT NULL DEFAULT 99,
  receptor_doc_nro text NOT NULL DEFAULT '0',
  env text NOT NULL DEFAULT 'homo',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_vendor_order_unique UNIQUE (vendor_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON public.invoices (vendor_id);

-- FEATURE DEL PLAN: fiscal = solo Gestión integral
UPDATE public.plans SET features = features || '{"fiscal": true}'::jsonb WHERE slug = 'gestion';
UPDATE public.plans SET features = features || '{"fiscal": false}'::jsonb WHERE slug <> 'gestion';
