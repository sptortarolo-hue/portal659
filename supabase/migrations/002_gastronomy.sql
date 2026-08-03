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
