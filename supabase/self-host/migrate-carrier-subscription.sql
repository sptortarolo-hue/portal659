-- ============================================================
-- Portal 659 Envíos v2 (ter) — suscripción de logísticas (Modelo B).
--
-- Reutiliza la infra de planes de comercios: la tabla `plans` gana
-- una columna `target` ('vendor' por defecto, 'carrier' para
-- logísticas). Los carriers ganan los mismos campos de plan que los
-- vendors, y `subscription_payments`/`plan_receipts` ganan `carrier_id`
-- (nullable: un pago es de vendor O de carrier).
--
-- Todo tolerante: sin migrar, el panel del operador muestra "plan
-- gratuito" y la renovación responde 503 nombrando la migración.
-- ============================================================

-- 1) Discriminador de planes: vendor (comercio) vs carrier (logística).
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'vendor'
  CHECK (target IN ('vendor', 'carrier'));

-- 2) Campos de plan en carriers (mismo patrón que vendors).
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS plan_status text NOT NULL DEFAULT 'gratuito'
  CHECK (plan_status IN ('gratuito', 'trial', 'active', 'expired', 'cancelled', 'past_due'));
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- 3) subscription_payments soporta carrier (vendor_id o carrier_id).
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES public.carriers(id) ON DELETE CASCADE;
-- Relajar NOT NULL de vendor_id para permitir pagos de carrier.
ALTER TABLE public.subscription_payments ALTER COLUMN vendor_id DROP NOT NULL;
-- CHECK: al menos uno de los dos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.subscription_payments'::regclass
      AND conname = 'chk_sub_payment_owner'
  ) THEN
    ALTER TABLE public.subscription_payments
      ADD CONSTRAINT chk_sub_payment_owner
      CHECK (vendor_id IS NOT NULL OR carrier_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sub_payments_carrier ON public.subscription_payments(carrier_id);

-- 4) plan_receipts soporta carrier.
ALTER TABLE public.plan_receipts ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES public.carriers(id) ON DELETE CASCADE;
ALTER TABLE public.plan_receipts ALTER COLUMN vendor_id DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.plan_receipts'::regclass
      AND conname = 'chk_plan_receipt_owner'
  ) THEN
    ALTER TABLE public.plan_receipts
      ADD CONSTRAINT chk_plan_receipt_owner
      CHECK (vendor_id IS NOT NULL OR carrier_id IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_plan_receipts_carrier ON public.plan_receipts(carrier_id);

-- 5) carrier_subscriptions (historial, mismo patrón que vendor_subscriptions).
CREATE TABLE IF NOT EXISTS public.carrier_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'gratuito'
    CHECK (status IN ('gratuito', 'trial', 'active', 'expired', 'cancelled', 'past_due')),
  period_start timestamptz,
  period_end timestamptz,
  amount numeric(10,2),
  payment_method text,
  paid_at timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_carrier_subs_carrier ON public.carrier_subscriptions(carrier_id, created_at DESC);

-- 6) Planes seed para logísticas (idempotente por slug+target).
INSERT INTO public.plans (slug, name, target, price_monthly, features, max_quotes_month, analytics_days)
VALUES
  ('carrier_gratuito', 'Transportista Gratuito', 'carrier', 0,
   '{"shipments": true, "analytics": false, "priority_support": false}'::jsonb,
   10, 0),
  ('carrier_pro', 'Transportista Pro', 'carrier', 4990,
   '{"shipments": true, "analytics": true, "priority_support": true}'::jsonb,
   NULL, 30)
ON CONFLICT (slug) DO UPDATE SET
  target = EXCLUDED.target,
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  features = EXCLUDED.features,
  max_quotes_month = EXCLUDED.max_quotes_month,
  analytics_days = EXCLUDED.analytics_days;
