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
  ('sicardi', 'Sicardi', -34.713, -58.410),
  ('garibaldi', 'Garibaldi', -34.717, -58.407),
  ('arana', 'Arana', -34.720, -58.413),
  ('correas', 'Correas', -34.724, -58.416);

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