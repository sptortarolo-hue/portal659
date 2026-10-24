-- Rollback seguro: vuelve a estado anterior (columna visible boolean original intacta)
ALTER TABLE public.vendors DROP COLUMN IF EXISTS visibility;
DROP INDEX IF EXISTS idx_vendors_visibility;