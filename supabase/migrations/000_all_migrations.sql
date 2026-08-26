-- ============================================================
-- MIGRATION: 001_init.sql
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  neighborhood text,
  phone text,
  whatsapp text,
  role text check (role in ('buyer', 'vendor', 'admin')) default 'buyer',
  verified boolean default false,
  created_at timestamptz default now()
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  store_name text not null,
  category text,
  neighborhood text,
  whatsapp text,
  accepting_quotes boolean default true,
  verified boolean default false,
  hours text,
  location text,
  created_at timestamptz default now()
);

create table if not exists neighborhoods (
  slug text primary key,
  name text not null,
  lat double precision,
  lng double precision
);

create table if not exists categories (
  slug text primary key,
  name text not null,
  description text
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id) on delete cascade,
  name text not null,
  description text,
  price numeric(10, 2) not null,
  currency text default 'ARS',
  category text,
  neighborhood text,
  type text check (type in ('product', 'service', 'food')),
  image_url text,
  stock integer,
  available boolean default true,
  created_at timestamptz default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  customer_id uuid references profiles(id),
  vendor_id uuid references vendors(id),
  booking_date date not null,
  booking_time time not null,
  notes text,
  status text check (status in ('pending', 'confirmed', 'cancelled')) default 'pending',
  created_at timestamptz default now()
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  customer_id uuid references profiles(id),
  vendor_id uuid references vendors(id),
  customer_name text not null,
  customer_email text not null,
  customer_phone text,
  details text,
  status text check (status in ('pending', 'responded', 'accepted')) default 'pending',
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid,
  sender_id uuid references profiles(id),
  content text not null,
  created_at timestamptz default now()
);

insert into neighborhoods (slug, name, lat, lng) values
  ('sicardi', 'Sicardi', -34.986, -57.858),
  ('garibaldi', 'Garibaldi', -35.000, -57.850),
  ('arana', 'Arana', -34.997, -57.893),
  ('correas', 'Correas', -35.049, -57.850);

insert into categories (slug, name, description) values
  ('reformas', 'Reformas y construcción', 'Plomería, electricidad, pintura, albañilería'),
  ('limpieza', 'Limpieza y mantenimiento', 'Limpieza de hogar, oficinas, locales'),
  ('transporte', 'Transporte y mudanzas', 'Camiones, mudanzas, fletes'),
  ('belleza', 'Belleza y estética', 'Peluquería, manicuría, depilación'),
  ('comida', 'Comida', 'Delivery, catering, rotisería');

create policy "Productos visibles para todos"
  on products for select
  using (available = true);

create policy "Vendedores pueden insertar sus productos"
  on products for insert
  with check (auth.uid() = vendor_id);

create policy "Vendedores pueden actualizar sus productos"
  on products for update
  using (
    exists (select 1 from vendors where id = vendor_id and user_id = auth.uid())
  );

-- ============================================================
-- MIGRATION: 002_gastronomy.sql
-- ============================================================
-- 002: conectaMOS gastronomía de barrio

-- Vendors: slug único para micrositios /tienda/[slug]
alter table vendors add column if not exists slug text unique;
alter table vendors add column if not exists address text;
alter table vendors add column if not exists hours text;
alter table vendors add column if not exists description text;
alter table vendors add column if not exists image_url text;

-- Products reusados como "ofertas gastronómicas" (menú del local)
alter table products add column if not exists featured_today boolean default false;
alter table products add column if not exists unit text;

-- Pedidos (el corazón del producto)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id) on delete cascade,
  customer_name text not null,
  customer_phone text not null,
  customer_address text,
  method text check (method in ('pickup', 'delivery')) default 'delivery',
  items jsonb not null default '[]'::jsonb,
  total numeric(10, 2) not null default 0,
  status text check (status in ('new', 'confirmed', 'completed', 'cancelled')) default 'new',
  created_at timestamptz default now()
);

create index if not exists orders_vendor_id_idx on orders (vendor_id);
create index if not exists orders_created_at_idx on orders (created_at);

-- Categorías gastronómicas
truncate categories;
insert into categories (slug, name, description) values
  ('empanadas', 'Empanadas', 'Empanadas caseras y al horno'),
  ('pizzas', 'Pizzas y fainá', 'Pizzas a la piedra, al molde y fainá'),
  ('pastas', 'Pastas caseras', 'Ravioles, ñoquis, tallarines y lasañas'),
  ('asado', 'Asado y parrilla', 'Asado, pollos y vacío al spiedo'),
  ('postres', 'Postres y tortas', 'Tortas, alfajores y postres caseros'),
  ('regional', 'Comida regional', 'Platos típicos de las regiones argentinas'),
  ('otras', 'Otras delicias', 'Todo lo que se cocina en el barrio');

-- Fix RLS de products: las políticas del 001 usaban auth.uid() = vendor_id
-- (nunca matchea porque vendor_id es el id de la fila vendors).
drop policy if exists "Vendedores pueden insertar sus productos" on products;
drop policy if exists "Vendedores pueden actualizar sus productos" on products;

create policy "Vendedores insertan sus productos"
  on products for insert
  with check (
    exists (
      select 1 from vendors
      where vendors.id = products.vendor_id
        and vendors.user_id = auth.uid()
    )
  );

create policy "Vendedores actualizan sus productos"
  on products for update
  using (
    exists (
      select 1 from vendors
      where vendors.id = products.vendor_id
        and vendors.user_id = auth.uid()
    )
  );

create policy "Vendedores eliminan sus productos"
  on products for delete
  using (
    exists (
      select 1 from vendors
      where vendors.id = products.vendor_id
        and vendors.user_id = auth.uid()
    )
  );

-- El vendedor ve todos sus productos (incluidos los pausados)
create policy "Vendedores ven sus productos"
  on products for select
  using (
    exists (
      select 1 from vendors
      where vendors.id = products.vendor_id
        and vendors.user_id = auth.uid()
    )
  );

-- Política de lectura pública de pedidos del propio vendedor
alter table orders enable row level security;
drop policy if exists "Vendedores ven sus pedidos" on orders;
create policy "Vendedores ven sus pedidos"
  on orders for select
  using (
    exists (
      select 1 from vendors
      where vendors.id = orders.vendor_id
        and vendors.user_id = auth.uid()
    )
  );

drop policy if exists "Cualquiera puede crear un pedido" on orders;
create policy "Cualquiera puede crear un pedido"
  on orders for insert
  with check (true);


-- ============================================================
-- MIGRATION: 003_rls_grants.sql
-- ============================================================
-- 003: grants y RLS para el stack local (y remoto)
-- En cloud Supabase las default privileges alcanzan, pero localmente hace falta
-- habilitar RLS y otorgar permisos explícitos a anon/authenticated/service_role.

-- RLS habilitado en tablas que lo necesitan
alter table profiles enable row level security;
alter table vendors enable row level security;
alter table products enable row level security;
alter table neighborhoods enable row level security;
alter table categories enable row level security;
alter table bookings enable row level security;
alter table quotes enable row level security;
alter table messages enable row level security;

-- Profiles: cada usuario ve y edita su propio perfil
drop policy if exists "Usuario ve su perfil" on profiles;
create policy "Usuario ve su perfil"
  on profiles for select
  using (id = auth.uid());

drop policy if exists "Usuario actualiza su perfil" on profiles;
create policy "Usuario actualiza su perfil"
  on profiles for update
  using (id = auth.uid());

-- Vendors: lectura pública (home y micrositio) + el dueño administra su local
drop policy if exists "Vendedores visibles para todos" on vendors;
create policy "Vendedores visibles para todos"
  on vendors for select
  using (true);

drop policy if exists "Vendedor ve su propio local" on vendors;
create policy "Vendedor ve su propio local"
  on vendors for select
  using (user_id = auth.uid());

drop policy if exists "Vendedor edita su propio local" on vendors;
create policy "Vendedor edita su propio local"
  on vendors for update
  using (user_id = auth.uid());

-- Barrios y categorías: lectura pública
drop policy if exists "Barrios visibles para todos" on neighborhoods;
create policy "Barrios visibles para todos"
  on neighborhoods for select
  using (true);

drop policy if exists "Categorías visibles para todos" on categories;
create policy "Categorías visibles para todos"
  on categories for select
  using (true);

-- Permisos por rol
grant usage on schema public to anon, authenticated, service_role;

grant select on all tables in schema public to anon;
grant insert on table public.orders to anon;

grant select, insert, update, delete on all tables in schema public to authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant all privileges on functions to service_role;


-- ============================================================
-- MIGRATION: 004_storage_realtime.sql
-- ============================================================
-- 004: storage (fotos de locales/platos), realtime de pedidos y perfil automático

-- Bucket público para imágenes del menú
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- Lectura pública de las imágenes (el upload va por el server con service_role)
drop policy if exists "Public read menu-images" on storage.objects;
create policy "Public read menu-images"
  on storage.objects for select
  using (bucket_id = 'menu-images');

-- Realtime: los vendedores ven los pedidos de su local al instante
alter publication supabase_realtime add table public.orders;
alter table public.orders replica identity full;

-- Perfil automático al crearse un usuario (rol viene del user_metadata)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    coalesce(new.raw_user_meta_data ->> 'role', 'buyer')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- MIGRATION: 005_vendor_logo.sql
-- ============================================================
-- Vendor logos: imagen cuadrada del local (distinta del banner image_url)
alter table public.vendors add column if not exists logo_url text;


-- ============================================================
-- MIGRATION: 006_vendor_categories.sql
-- ============================================================
-- Categorías propias de cada local para separar el menú (estilo apps de delivery).
-- products.category guarda el nombre de la categoría (texto); esta tabla define
-- el orden y las categorías disponibles para cada local.
create table if not exists public.vendor_categories (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists vendor_categories_vendor_name_key
  on public.vendor_categories(vendor_id, lower(name));

alter table public.vendor_categories enable row level security;

drop policy if exists "Categorías del local visibles para todos" on public.vendor_categories;
create policy "Categorías del local visibles para todos"
  on public.vendor_categories for select
  using (true);

drop policy if exists "Vendedor gestiona sus categorías" on public.vendor_categories;
create policy "Vendedor gestiona sus categorías"
  on public.vendor_categories for all
  to authenticated
  using (vendor_id in (select id from public.vendors where user_id = auth.uid()))
  with check (vendor_id in (select id from public.vendors where user_id = auth.uid()));

grant select on public.vendor_categories to anon;
grant select, insert, update, delete on public.vendor_categories to authenticated;
grant all privileges on public.vendor_categories to service_role;


-- ============================================================
-- MIGRATION: 007_vendor_vertical.sql
-- ============================================================
alter table public.vendors
  add column vertical text not null default 'gastronomia'
  check (vertical in ('gastronomia', 'almacen', 'servicio', 'otro'));


-- ============================================================
-- MIGRATION: 008_vendor_extras.sql
-- ============================================================
alter table public.vendors
  add column phone text,
  add column instagram text,
  add column facebook text,
  add column payment_methods text,
  add column delivery_options text default 'ambos',
  add column services_list text,
  add column service_area text,
  add column free_estimate boolean default true;


-- ============================================================
-- MIGRATION: 009_vertical_expansion.sql
-- ============================================================
-- 009: Expand vertical CHECK constraint to include new business types
-- Renames 'almacen' to 'comercio' for existing data, then adds new values

-- First, migrate existing 'almacen' data to 'comercio'
UPDATE public.vendors SET vertical = 'comercio' WHERE vertical = 'almacen';

-- Drop the old CHECK constraint and add the new one
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_vertical_check;

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'varios', 'otro'));


-- ============================================================
-- MIGRATION: 010_search.sql
-- ============================================================
-- 010: Fix mascotas CHECK constraint
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_vertical_check;

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'varios', 'mascotas', 'otro'));


-- ============================================================
-- MIGRATION: 011_cms_expansion.sql
-- ============================================================
-- 011: CMS Expansion - Modifiers, Gallery, Stock, Scheduling, Urgency

-- ============================================================
-- 1. Modificadores de producto (gastronomía, moda, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  group_name text NOT NULL,          -- "Tamaño", "Extras", "Sin/Con"
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- options: [{"label":"Con fritas","price_mod":0},{"label":"Sin fritas","price_mod":0}]
  required boolean NOT NULL DEFAULT false,
  max_selections int NOT NULL DEFAULT 1,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_modifiers_product ON public.product_modifiers(product_id);

-- ============================================================
-- 2. Galería de fotos (servicios, moda, portafolio)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_gallery_vendor ON public.vendor_gallery(vendor_id);

-- ============================================================
-- 3. Columnas nuevas en vendors
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN prep_time_min int;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN urgent_enabled boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 4. Columnas nuevas en products
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN stock_low_threshold int DEFAULT 5;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN promo_price numeric(10,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 5. RLS policies (allow vendor access)
-- ============================================================
ALTER TABLE public.product_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_gallery ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Vendors manage own modifiers" ON public.product_modifiers;
  CREATE POLICY "Vendors manage own modifiers" ON public.product_modifiers
    USING (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())));

  DROP POLICY IF EXISTS "Public read modifiers" ON public.product_modifiers;
  CREATE POLICY "Public read modifiers" ON public.product_modifiers FOR SELECT USING (true);
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Vendors manage own gallery" ON public.vendor_gallery;
  CREATE POLICY "Vendors manage own gallery" ON public.vendor_gallery
    USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));

  DROP POLICY IF EXISTS "Public read gallery" ON public.vendor_gallery;
  CREATE POLICY "Public read gallery" ON public.vendor_gallery FOR SELECT USING (true);
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;


-- ============================================================
-- MIGRATION: 012_reviews_orders.sql
-- ============================================================
-- Reviews (reseñas con estrellas)
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

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cualquiera puede leer reseñas" ON reviews FOR SELECT USING (true);
CREATE POLICY "Usuarios autenticados pueden insertar reseñas" ON reviews FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Pedidos: agregar customer_id para que el comprador pueda ver sus pedidos
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id UUID;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);


-- ============================================================
-- MIGRATION: 013_admin.sql
-- ============================================================
-- Admin: agregar columna is_admin a vendors
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Marcar vendedor1 como admin para testing
UPDATE vendors SET is_admin = true WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'test@test.com'
);


-- ============================================================
-- MIGRATION: 014_notifications.sql
-- ============================================================
-- Notificaciones in-app
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

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven sus notificaciones" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Sistema puede insertar notificaciones" ON notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Usuarios pueden marcar como leídas" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);


-- ============================================================
-- MIGRATION: 015_favorites.sql
-- ============================================================
-- Favoritos
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven sus favoritos" ON favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden agregar favoritos" ON favorites
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Usuarios pueden eliminar favoritos" ON favorites
  FOR DELETE USING (auth.uid() = user_id);


-- ============================================================
-- MIGRATION: 016_payment_quotes_bookings.sql
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
-- MIGRATION: 017_order_flow_gastro.sql
-- ============================================================
-- 017: Flow de pedido gastronomía completo
-- Campos nuevos en orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Expandir estados válidos: +preparing +ready
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'));

-- Tabla de audit log de cambios de estado
CREATE TABLE IF NOT EXISTS order_status_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_status_log_order ON order_status_log(order_id);

-- Trigger para updated_at automático
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

-- Índices para búsquedas por teléfono y estado
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);


-- ============================================================
-- MIGRATION: 018_rls_order_log.sql
-- ============================================================
ALTER TABLE order_status_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role can insert log' AND tablename = 'order_status_log') THEN
    DROP POLICY "Service role can insert log" ON order_status_log;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role can read log' AND tablename = 'order_status_log') THEN
    DROP POLICY "Service role can read log" ON order_status_log;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendors can insert status log' AND tablename = 'order_status_log') THEN
    CREATE POLICY "Vendors can insert status log" ON order_status_log
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM orders
          WHERE orders.id = order_status_log.order_id
          AND orders.vendor_id IN (
            SELECT id FROM vendors WHERE user_id = auth.uid()
          )
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can read order log' AND tablename = 'order_status_log') THEN
    CREATE POLICY "Anyone can read order log" ON order_status_log
      FOR SELECT
      USING (true);
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 019_orders_update_rls.sql
-- ============================================================
-- Policy: vendors can update their own orders
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Vendedores actualizan sus pedidos' AND tablename = 'orders') THEN
    CREATE POLICY "Vendedores actualizan sus pedidos"
      ON orders FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM vendors
          WHERE vendors.id = orders.vendor_id
            AND vendors.user_id = auth.uid()
        )
      );
  END IF;
END $$;


-- ============================================================
-- MIGRATION: 020_printer_settings.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS printer_ip text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS printer_port integer DEFAULT 9100;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS paper_size text DEFAULT '80mm';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS auto_print boolean DEFAULT false;


-- ============================================================
-- MIGRATION: 021_order_status_sent.sql
-- ============================================================
-- Agregar estado 'sent' (enviado) para delivery
-- Flujo delivery: new -> confirmed -> preparing -> ready -> sent -> completed
-- Flujo pickup:   new -> confirmed -> preparing -> ready -> completed (sin cambios)

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'confirmed', 'preparing', 'ready', 'sent', 'completed', 'cancelled'));


-- ============================================================
-- MIGRATION: 022_order_modification.sql
-- ============================================================
-- Agregar campo para notas de modificación del pedido
ALTER TABLE orders ADD COLUMN IF NOT EXISTS modification_notes text;


-- ============================================================
-- MIGRATION: 023_product_variants.sql
-- ============================================================
-- 021: Variantes de productos (indumentaria / moda)
-- Aislado: solo afecta a productos con variantes (has_variants). Las demás categorías no cambian.

-- ============================================================
-- 1. Columna has_variants en products
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN has_variants boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 2. Tabla product_variants (color × talle, precio y stock por combinación)
-- ============================================================
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

-- ============================================================
-- 3. Galería de fotos por producto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON public.product_images(product_id);

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read variants" ON public.product_variants;
  CREATE POLICY "Public read variants" ON public.product_variants FOR SELECT USING (true);

  DROP POLICY IF EXISTS "Vendors manage own variants" ON public.product_variants;
  CREATE POLICY "Vendors manage own variants" ON public.product_variants
    USING (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())))
    WITH CHECK (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())));
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read product images" ON public.product_images;
  CREATE POLICY "Public read product images" ON public.product_images FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Vendors manage own product images" ON public.product_images;
  CREATE POLICY "Vendors manage own product images" ON public.product_images
    USING (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())))
    WITH CHECK (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())));
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

-- ============================================================
-- MIGRATION: 024_vendor_coords.sql
-- ============================================================
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lng double precision;


