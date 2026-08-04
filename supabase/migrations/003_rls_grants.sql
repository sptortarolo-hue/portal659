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
