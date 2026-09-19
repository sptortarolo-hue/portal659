-- Módulo Clientes (CRM v1, estilo Fudo base) — gastronomía (plan Gestión integral).
-- Libro de clientes por comercio, derivado de los pedidos con teléfono real
-- (app / delivery de mostrador / MP). Mesa y mostrador-retiro no llevan
-- cliente: no generan fichas.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-crm.sql

-- ============================================================
-- CLIENTES
-- phone: normalizado a E.164 sin "+" (549XXXXXXXXXX), o "lid:<id>" para
--   chats del bot sin teléfono real (no se les puede escribir por fuera).
-- total_orders/total_spent: acumulativo; al cancelar un pedido la API los
--   resta (el libro queda con compras reales, no pedidos anulados).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  address text,
  notes text,
  last_order_at timestamptz,
  total_orders int NOT NULL DEFAULT 0,
  total_spent numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_vendor_phone ON public.customers(vendor_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_vendor_spent ON public.customers(vendor_id, total_spent DESC);
CREATE INDEX IF NOT EXISTS idx_customers_vendor_last_order ON public.customers(vendor_id, last_order_at DESC);

-- Trigger updated_at (mismo patrón que orders; función autónoma por si esta
-- migración corre sobre una DB sin migrate-orders-updated-at.sql).
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS customers_updated_at ON public.customers;
CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- FEATURE DEL PLAN: crm = Gestión integral
-- ============================================================
UPDATE public.plans SET features = features || '{"crm": true}'::jsonb WHERE slug = 'gestion';
UPDATE public.plans SET features = features || '{"crm": false}'::jsonb WHERE slug <> 'gestion';

-- ============================================================
-- BACKFILL: fichas desde pedidos de la app con teléfono real (549...).
-- Solo compras no canceladas. Los mostrador/mesa se llenan solos de acá en
-- más (delivery con teléfono, etc.).
-- ============================================================
INSERT INTO public.customers (vendor_id, phone, name, last_order_at, total_orders, total_spent)
SELECT o.vendor_id,
       o.customer_phone,
       (ARRAY_AGG(o.customer_name ORDER BY o.created_at DESC))[1],
       MAX(o.created_at),
       COUNT(*)::int,
       COALESCE(SUM(o.total), 0)
FROM public.orders o
WHERE o.channel = 'app' AND o.customer_phone LIKE '549%' AND o.status != 'cancelled'
GROUP BY o.vendor_id, o.customer_phone
ON CONFLICT (vendor_id, phone) DO NOTHING;
