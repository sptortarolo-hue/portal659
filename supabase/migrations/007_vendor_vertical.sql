alter table public.vendors
  add column vertical text not null default 'gastronomia'
  check (vertical in ('gastronomia', 'almacen', 'servicio', 'otro'));
