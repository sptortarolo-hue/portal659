-- ============================================================================
-- Servicios — Nivel 1 "Oficios" ($2.990/mes): cotizar con precio, seña por
-- Mercado Pago, urgencia con recargo, reseñas, destacado y analytics 30 días.
-- ----------------------------------------------------------------------------
-- Columnas:
--   quotes.quoted_price / deposit_amount / deposit_pct / deposit_status /
--     mp_payment_id / accepted_at
--   vendors.urgent_surcharge_pct (% recargo urgencia, NULL = sin recargo)
--   vendors.deposit_default_pct (% seña por defecto, NULL = 30)
-- Plan:
--   oficios $2.990: quotes_respond + deposits + urgent + reviews_manage +
--     priority + analytics 30 días + mp_payments. Sin tope de solicitudes.
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-service-oficios.sql
-- ============================================================================

-- Cotización formal + seña.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS quoted_price numeric(10, 2),
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS deposit_pct numeric(5, 2),
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'none'
    CHECK (deposit_status IN ('none', 'pending', 'paid')),
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- Recargo de urgencia configurable (%) + % de seña por defecto.
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS urgent_surcharge_pct numeric(5, 2),
  ADD COLUMN IF NOT EXISTS deposit_default_pct numeric(5, 2);

-- Plan Oficios: id fijo 6f000000-0000-4000-8000-000000000004 (PLAN_IDS en plans.ts).
INSERT INTO public.plans (id, slug, name, description, price_monthly, max_products, max_orders_month, max_quotes_month, features, badge, popular, sort)
VALUES (
  '6f000000-0000-4000-8000-000000000004',
  'oficios',
  'Oficios',
  'Para plomeros, electricistas y oficios: presupuestos ilimitados, cotización con precio, seña por Mercado Pago, urgencia con recargo y reseñas.',
  2990,
  NULL,
  NULL,
  NULL,
  '{"info": true, "cart": false, "emits_orders": false, "mp_payments": true, "kds": false, "printer": false, "variants": false, "modifiers": false, "urgent": true, "pos": false, "mesas": false, "reviews_manage": true, "analytics_days": 30, "priority": true, "recipes": false, "crm": false, "quotes_respond": true, "deposits": true}'::jsonb,
  NULL,
  false,
  40
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  max_quotes_month = EXCLUDED.max_quotes_month,
  features = EXCLUDED.features,
  sort = EXCLUDED.sort;
