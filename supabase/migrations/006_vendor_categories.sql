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
