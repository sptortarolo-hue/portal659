-- ============================================================
-- requires_prep: flag por producto. true = va a cocina (default),
-- false = venta directa (bebidas, packs, etc.) → no entra al flow de cocina.
-- Correr: docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/migrate-requires-prep.sql
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS requires_prep boolean NOT NULL DEFAULT true;
