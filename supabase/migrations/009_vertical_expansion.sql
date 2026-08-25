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
