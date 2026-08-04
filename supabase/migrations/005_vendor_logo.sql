-- Vendor logos: imagen cuadrada del local (distinta del banner image_url)
alter table public.vendors add column if not exists logo_url text;
