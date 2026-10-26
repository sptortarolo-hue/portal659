-- ============================================================================
-- Pagos de planes por transferencia: reclamo + comprobante + recibo X.
-- ----------------------------------------------------------------------------
-- 1) subscription_payments: cada intento de renovación/activación por
--    transferencia. Nace 'pending' cuando el comercio toca "Renovar", se
--    completa con el comprobante que sube (imagen/PDF vía
--    POST /api/vendor/suscripcion/pagos/[id]/comprobante) y el admin la
--    aprueba o rechaza desde /admin/suscripciones.
-- 2) plan_receipts: Recibo X ("documento no válido como factura") emitido al
--    aprobar el pago. Numeración global por año.
-- 3) subscription_reminder_log: anti-duplicados de los avisos por ciclo de
--    vencimiento (kind t7/t2/vencido), key = fecha del período en huso AR.
-- 4) portal_bank: fila única con los datos de cobro del PORTAL (alias/CBU/
--    titular/QR), editable en /admin/suscripciones. Antes el pago de planes
--    mostraba por error el CBU del comercio (ese es para sus clientes).
-- 5) vendors.plan_status suma 'past_due' (gracia): mientras haya un reclamo
--    pendiente el plan NO corta las features pagas (resolveVendorPlan).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-plan-payments.sql
-- ============================================================================

-- 1) Reclamos de pago ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.plans(id),
  subscription_id uuid REFERENCES public.vendor_subscriptions(id),
  amount numeric NOT NULL CHECK (amount >= 0),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  reference text NOT NULL,
  method text NOT NULL DEFAULT 'transferencia',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Snapshot del precio cobrado (para que el recibo explique de dónde salió el
  -- monto aunque el plan cambie de precio o se venza la promo).
  promo_pct integer,
  promo_list_price numeric,
  comprobante_url text,
  comprobante_name text,
  comprobante_at timestamptz,
  -- Último recordatorio enviado al comercio (idempotencia del "Recordarle").
  last_nudge_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_vendor
  ON public.subscription_payments(vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_pending
  ON public.subscription_payments(status, created_at)
  WHERE status = 'pending';
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS last_nudge_at timestamptz,
  ADD COLUMN IF NOT EXISTS promo_pct integer,
  ADD COLUMN IF NOT EXISTS promo_list_price numeric;

-- 2) Recibos X ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plan_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  payment_id uuid REFERENCES public.subscription_payments(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES public.plans(id),
  plan_name text,
  amount numeric NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  method text NOT NULL DEFAULT 'transferencia',
  -- Snapshot del descuento aplicado (para que el recibo explique de dónde
  -- salió el monto aunque el plan cambie de precio después).
  promo_pct integer,
  promo_list_price numeric,
  -- Numeración global por año ("Recibo X Nº 0001/2026"), opaca para el comercio.
  seq integer NOT NULL,
  year integer NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz
);
ALTER TABLE public.plan_receipts
  ADD COLUMN IF NOT EXISTS promo_pct integer,
  ADD COLUMN IF NOT EXISTS promo_list_price numeric;
CREATE INDEX IF NOT EXISTS idx_plan_receipts_vendor
  ON public.plan_receipts(vendor_id, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_receipts_seq
  ON public.plan_receipts(year, seq);

-- 3) Log de recordatorios (anti-duplicados por ciclo) -------------------------
CREATE TABLE IF NOT EXISTS public.subscription_reminder_log (
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('t7', 't2', 'vencido')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, period_key, kind)
);

-- 4) Datos bancarios del portal (fila única) ----------------------------------
CREATE TABLE IF NOT EXISTS public.portal_bank (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  alias text,
  cbu text,
  titular text,
  qr_url text,
  whatsapp text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.portal_bank
  ADD COLUMN IF NOT EXISTS whatsapp text;
INSERT INTO public.portal_bank (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 5) Gracia: plan_status 'past_due' -------------------------------------------
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_plan_status_check;
ALTER TABLE public.vendors ADD CONSTRAINT vendors_plan_status_check
  CHECK (plan_status IN ('gratuito', 'trial', 'active', 'expired', 'cancelled', 'past_due'));

COMMENT ON COLUMN public.vendors.plan_status IS
  'gratuito | trial | active | past_due (gracia: pago en revisión, features pagas vigentes) | expired | cancelled';
