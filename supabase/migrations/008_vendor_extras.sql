alter table public.vendors
  add column phone text,
  add column instagram text,
  add column facebook text,
  add column payment_methods text,
  add column delivery_options text default 'ambos',
  add column services_list text,
  add column service_area text,
  add column free_estimate boolean default true;
