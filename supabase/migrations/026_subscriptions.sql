-- 026: Sistema de suscripciones (planes + vendor_subscriptions)
-- Solo gastronomía tiene planes pagos; el resto queda en Gratuito por ahora.

-- ============================================================
-- 1. Tabla plans
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  max_products integer,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  badge text,
  popular boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read plans" ON public.plans;
CREATE POLICY "Public read plans" ON public.plans FOR SELECT USING (true);

-- ============================================================
-- 2. Seed de planes (IDs fijos para referencias) + upsert
-- ============================================================
INSERT INTO public.plans (id, slug, name, description, price_monthly, max_products, features, badge, popular, sort) VALUES
  ('6f000000-0000-4000-8000-000000000001', 'gratuito', 'Gratuito',
   'Presencia en el directorio con ficha y catálogo informativo (3 productos).',
   0, 3,
   '{"info": true, "cart": false, "emits_orders": false, "mp_payments": false, "kds": false, "printer": false, "variants": false, "modifiers": false, "urgent": false, "pos": false, "mesas": false, "reviews_manage": false, "analytics_days": 0, "priority": false}'::jsonb,
   'Gratuito', false, 1),
  ('6f000000-0000-4000-8000-000000000002', 'pedidos', 'Pedidos',
   'Carrito, checkout y pedidos por WhatsApp, cotizaciones y turnos (hasta 50 productos).',
   4990, 50,
   '{"info": true, "cart": true, "emits_orders": true, "mp_payments": false, "kds": false, "printer": false, "variants": false, "modifiers": false, "urgent": false, "pos": false, "mesas": false, "reviews_manage": true, "analytics_days": 7, "priority": false}'::jsonb,
   'Pedidos', true, 2),
  ('6f000000-0000-4000-8000-000000000003', 'gestion', 'Gestión integral',
   'Todo lo anterior más gestión completa: estados de pedido, KDS, impresión, mostrador, mesas, cobro online y productos ilimitados.',
   12990, NULL,
   '{"info": true, "cart": true, "emits_orders": true, "mp_payments": true, "kds": true, "printer": true, "variants": true, "modifiers": true, "urgent": true, "pos": true, "mesas": true, "reviews_manage": true, "analytics_days": 99999, "priority": true}'::jsonb,
   'Premium', false, 3)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  max_products = EXCLUDED.max_products,
  features = EXCLUDED.features,
  badge = EXCLUDED.badge,
  popular = EXCLUDED.popular,
  sort = EXCLUDED.sort;

-- ============================================================
-- 3. vendor_subscriptions (histórico de períodos)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'trial'
    CHECK (status IN ('trial', 'active', 'expired', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_subscriptions_vendor ON public.vendor_subscriptions(vendor_id);

ALTER TABLE public.vendor_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendor reads own subscriptions" ON public.vendor_subscriptions;
CREATE POLICY "Vendor reads own subscriptions"
  ON public.vendor_subscriptions FOR SELECT
  USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));

-- ============================================================
-- 4. Columnas en vendors (denormalizadas para lecturas rápidas)
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN plan_id uuid DEFAULT '6f000000-0000-4000-8000-000000000001';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN plan_status text NOT NULL DEFAULT 'gratuito'
    CHECK (plan_status IN ('gratuito', 'trial', 'active', 'expired', 'cancelled'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN plan_expires_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN trial_ends_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendors_plan') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT fk_vendors_plan
      FOREIGN KEY (plan_id) REFERENCES public.plans(id);
  END IF;
END $$;

-- Backfill: todos los vendors actuales quedan en Gratuito
UPDATE public.vendors
SET plan_id = '6f000000-0000-4000-8000-000000000001'
WHERE plan_id IS NULL;