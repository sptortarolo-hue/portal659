-- Suscripciones: campos de pago (cobro manual: efectivo / transferencia / mercadopago).
-- El admin registra el cobro y la fecha; no hay automatismo por ahora.

DO $$ BEGIN
  ALTER TABLE public.vendor_subscriptions ADD COLUMN payment_method text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendor_subscriptions ADD COLUMN amount numeric(10,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendor_subscriptions ADD COLUMN paid_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_subscriptions_vendor_created
  ON public.vendor_subscriptions(vendor_id, created_at DESC);