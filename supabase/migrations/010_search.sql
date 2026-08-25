-- 010: Fix mascotas CHECK constraint
ALTER TABLE public.vendors
  DROP CONSTRAINT IF EXISTS vendors_vertical_check;

ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'varios', 'mascotas', 'otro'));
