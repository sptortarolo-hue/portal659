-- ============================================================
-- SCHEMA LIMPIO PARA POSTGRES PLANO (self-host en VPS)
-- Reemplaza 000_all_migrations.sql eliminando dependencias de
-- Supabase (auth.*, storage, realtime, RLS). La autorización se
-- hace en la capa de API (src/lib/db.ts + JWT), no vía RLS.
-- ============================================================

-- ============================================================
-- USUARIOS (reemplaza auth.users + profiles de Supabase)
-- profiles es la tabla de usuarios: contiene credenciales.
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL DEFAULT '',
  reset_token_hash text,
  reset_token_expires timestamptz,
  magic_token_hash text,
  magic_token_expires timestamptz,
  full_name text,
  neighborhood text,
  phone text,
  whatsapp text,
  role text CHECK (role IN ('buyer', 'vendor', 'admin')) DEFAULT 'buyer',
  is_admin boolean DEFAULT false,
  verified boolean DEFAULT false,
  email_confirmed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- 001_init.sql (sin FK a auth.users ni políticas RLS)
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  category text,
  neighborhood text,
  whatsapp text,
  accepting_quotes boolean DEFAULT true,
  verified boolean DEFAULT false,
  hours text,
  location text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS neighborhoods (
  slug text PRIMARY KEY,
  name text NOT NULL,
  lat double precision,
  lng double precision
);

CREATE TABLE IF NOT EXISTS categories (
  slug text PRIMARY KEY,
  name text NOT NULL,
  description text
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(10, 2) NOT NULL,
  currency text DEFAULT 'ARS',
  category text,
  neighborhood text,
  type text CHECK (type IN ('product', 'service', 'food')),
  image_url text,
  stock integer,
  available boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES profiles(id),
  vendor_id uuid REFERENCES vendors(id),
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  notes text,
  status text CHECK (status IN ('pending', 'confirmed', 'cancelled')) DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid,
  sender_id uuid REFERENCES profiles(id),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

INSERT INTO neighborhoods (slug, name, lat, lng) VALUES
  ('sicardi', 'Sicardi', -34.986, -57.858),
  ('garibaldi', 'Garibaldi', -35.000, -57.850),
  ('arana', 'Arana', -34.997, -57.893),
  ('correas', 'Correas', -35.049, -57.850)
ON CONFLICT (slug) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng;

INSERT INTO categories (slug, name, description) VALUES
  ('reformas', 'Reformas y construcción', 'Plomería, electricidad, pintura, albañilería'),
  ('limpieza', 'Limpieza y mantenimiento', 'Limpieza de hogar, oficinas, locales'),
  ('transporte', 'Transporte y mudanzas', 'Camiones, mudanzas, fletes'),
  ('belleza', 'Belleza y estética', 'Peluquería, manicuría, depilación'),
  ('comida', 'Comida', 'Delivery, catering, rotisería')
ON CONFLICT (slug) DO UPDATE SET name = excluded.name, description = excluded.description;

-- ============================================================
-- 002_gastronomy.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS slug text UNIQUE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS hours text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE products ADD COLUMN IF NOT EXISTS featured_today boolean DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit text;

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_address text,
  method text CHECK (method IN ('pickup', 'delivery')) DEFAULT 'delivery',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(10, 2) NOT NULL DEFAULT 0,
  status text CHECK (status IN ('new', 'confirmed', 'completed', 'cancelled')) DEFAULT 'new',
  device_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_vendor_id_idx ON orders (vendor_id);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_device ON orders(device_id) WHERE device_id IS NOT NULL;

-- ============================================================
-- 003_rls_grants.sql  --> OMITIDO (no hay RLS ni roles Supabase)
-- ============================================================

-- ============================================================
-- 004_storage_realtime.sql --> OMITIDO (storage a disco, sin realtime)
-- ============================================================

-- ============================================================
-- 005_vendor_logo.sql
-- ============================================================
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS logo_url text;

-- ============================================================
-- 006_vendor_categories.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_categories_vendor_name_key
  ON public.vendor_categories(vendor_id, lower(name));

-- ============================================================
-- 007_vendor_vertical.sql
-- ============================================================
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'gastronomia';

-- ============================================================
-- 008_vendor_extras.sql
-- ============================================================
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS instagram text,
  ADD COLUMN IF NOT EXISTS facebook text,
  ADD COLUMN IF NOT EXISTS payment_methods text,
  ADD COLUMN IF NOT EXISTS delivery_options text DEFAULT 'ambos',
  ADD COLUMN IF NOT EXISTS services_list text,
  ADD COLUMN IF NOT EXISTS service_area text,
  ADD COLUMN IF NOT EXISTS free_estimate boolean DEFAULT true;

-- ============================================================
-- 009_vertical_expansion.sql + 010_search.sql
-- ============================================================
UPDATE public.vendors SET vertical = 'comercio' WHERE vertical = 'almacen';
ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_vertical_check;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'varios', 'mascotas', 'otro'));

-- ============================================================
-- 011_cms_expansion.sql (sin RLS)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  max_selections int NOT NULL DEFAULT 1,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_modifiers_product ON public.product_modifiers(product_id);

CREATE TABLE IF NOT EXISTS public.vendor_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendor_gallery_vendor ON public.vendor_gallery(vendor_id);

DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN prep_time_min int;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN urgent_enabled boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN stock_low_threshold int DEFAULT 5;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN promo_price numeric(10,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 012_reviews_orders.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_vendor ON reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id UUID;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

-- ============================================================
-- 013_admin.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- ============================================================
-- 014_notifications.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  read BOOLEAN DEFAULT false,
  link TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = false;

-- ============================================================
-- 015_favorites.sql
-- ============================================================
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  device_id text,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_user ON favorites(user_id, vendor_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_favorites_device ON favorites(device_id, vendor_id) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_favorites_device ON favorites(device_id);

-- ============================================================
-- 016_payment_quotes_bookings.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_cbu text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_alias text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS transfer_qr_url text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS accepting_quotes boolean DEFAULT true;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'whatsapp';

CREATE TABLE IF NOT EXISTS quotes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  service_name text,
  description text NOT NULL,
  preferred_date text,
  preferred_time text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'responded', 'accepted', 'cancelled')),
  vendor_notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS product_name text;

-- ============================================================
-- 017_order_flow_gastro.sql
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'));

CREATE TABLE IF NOT EXISTS order_status_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_status_log_order ON order_status_log(order_id);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_updated_at ON orders;
CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================================
-- 018_rls_order_log.sql --> OMITIDO
-- 019_orders_update_rls.sql --> OMITIDO
-- ============================================================

-- ============================================================
-- 020_printer_settings.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS printer_ip text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS printer_port integer DEFAULT 9100;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paper_size text DEFAULT '80mm';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS auto_print boolean DEFAULT false;

-- ============================================================
-- 021_order_status_sent.sql
-- ============================================================
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'sent', 'completed', 'cancelled'));

-- ============================================================
-- 022_order_modification.sql
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS modification_notes text;

-- ============================================================
-- 023_product_variants.sql
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN has_variants boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color text NOT NULL,
  talle text NOT NULL,
  price numeric(10,2) NOT NULL,
  promo numeric(10,2),
  stock integer NOT NULL DEFAULT 0,
  sku text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);

CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON public.product_images(product_id);

-- ============================================================
-- 024_vendor_coords.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lng double precision;

-- ============================================================
-- 025_most_ordered_rpc.sql (función corregida con LATERAL)
-- ============================================================
CREATE OR REPLACE FUNCTION get_most_ordered_products(
  p_days int DEFAULT 7,
  p_limit int DEFAULT 5,
  p_zone text[] DEFAULT NULL
)
RETURNS TABLE(
  product_id text,
  product_name text,
  total_qty bigint,
  store_name text,
  store_slug text,
  store_vertical text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    item->>'product_id' AS product_id,
    item->>'name' AS product_name,
    SUM((item->>'qty')::int) AS total_qty,
    v.store_name,
    v.slug AS store_slug,
    v.vertical AS store_vertical
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
  JOIN vendors v ON v.id = o.vendor_id
  WHERE o.created_at > now() - (p_days || ' days')::interval
    AND o.status NOT IN ('cancelled')
    AND (item->>'product_id') IS NOT NULL
    AND (item->>'product_id') != ''
    AND (p_zone IS NULL OR v.neighborhood = ANY(p_zone))
  GROUP BY item->>'product_id', item->>'name', v.store_name, v.slug, v.vertical
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- 026_subscriptions.sql (sistema de planes, sin RLS)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  max_products integer,
  max_orders_month integer,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  badge text,
  popular boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.plans (id, slug, name, description, price_monthly, max_products, max_orders_month, features, badge, popular, sort) VALUES
  ('6f000000-0000-4000-8000-000000000001', 'gratuito', 'Gratuito',
   'Carta completa con carrito y pedidos por la app (hasta 20 pedidos por mes).',
   0, NULL, 20,
   '{"info": true, "cart": true, "emits_orders": true, "mp_payments": false, "kds": false, "printer": false, "variants": false, "modifiers": false, "urgent": false, "pos": false, "mesas": false, "reviews_manage": false, "analytics_days": 0, "priority": false}'::jsonb,
   'Gratuito', false, 1),
  ('6f000000-0000-4000-8000-000000000002', 'pedidos', 'Pedidos',
   'Pedidos por la app sin límite mensual, analytics y gestión de reseñas.',
   4990, NULL, NULL,
   '{"info": true, "cart": true, "emits_orders": true, "mp_payments": false, "kds": false, "printer": false, "variants": false, "modifiers": false, "urgent": false, "pos": false, "mesas": false, "reviews_manage": true, "analytics_days": 7, "priority": false}'::jsonb,
   'Pedidos', true, 2),
  ('6f000000-0000-4000-8000-000000000003', 'gestion', 'Gestión integral',
   'Todo lo anterior más gestión completa: estados de pedido, KDS, impresión, mostrador, mesas, cobro online y productos ilimitados.',
   12990, NULL, NULL,
   '{"info": true, "cart": true, "emits_orders": true, "mp_payments": true, "kds": true, "printer": true, "variants": true, "modifiers": true, "urgent": true, "pos": true, "mesas": true, "reviews_manage": true, "analytics_days": 99999, "priority": true}'::jsonb,
   'Premium', false, 3)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price_monthly = EXCLUDED.price_monthly,
  max_products = EXCLUDED.max_products,
  max_orders_month = EXCLUDED.max_orders_month,
  features = EXCLUDED.features,
  badge = EXCLUDED.badge,
  popular = EXCLUDED.popular,
  sort = EXCLUDED.sort;

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

UPDATE public.vendors
SET plan_id = '6f000000-0000-4000-8000-000000000001'
WHERE plan_id IS NULL;

-- ============================================================
-- 027_tables_pos.sql (mesas y canales de order, sin RLS)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'libre'
    CHECK (status IN ('libre', 'ocupada', 'reservada')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tables_vendor ON public.tables(vendor_id);

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN channel text NOT NULL DEFAULT 'app'
    CHECK (channel IN ('app', 'mostrador', 'mesa'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN paid_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN table_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_table') THEN
    ALTER TABLE public.orders ADD CONSTRAINT fk_orders_table
      FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_orders_table ON public.orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON public.orders(channel);

-- ============================================================
-- 028_sprint4.sql (info_items, reviews.reply, vendors.featured)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.info_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone text NOT NULL DEFAULT 'sicardi-garibaldi',
  category text NOT NULL CHECK (category IN ('transporte', 'utilidades', 'horarios', 'noticias')),
  title text NOT NULL,
  body text,
  tags text[],
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (zone, category, title)
);

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply_by text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS replied_at timestamptz;

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;

-- ============================================================
-- Trigger updated_at para profiles
-- ============================================================
DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();