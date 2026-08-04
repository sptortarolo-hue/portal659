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
