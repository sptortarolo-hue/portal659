-- Módulo "Envasado" v2 — vencimiento (granel → paquetes).
-- Aditivo e idempotente; no toca columnas existentes.
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-elaboration-v2.sql
-- Sin esta migración: la etiqueta sigue imprimiendo VENCE si el producto tiene
-- expires_at, y el inventario "Vencimientos" sigue funcionando; solo no se
-- persiste el vencimiento por lote ni se hereda del granel al producto.

-- ============================================================
-- INSUMOS (granel): fecha de vencimiento del lote de compra.
-- NULL = sin control de vencimiento (como siempre).
-- ============================================================
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS expires_at date;

COMMENT ON COLUMN public.ingredients.expires_at IS
  'Fecha de vencimiento del lote de compra del insumo (granel). NULL = sin control.';

-- ============================================================
-- LOTES DE ENVASADO: vencimiento por lote (trazabilidad).
-- NULL = sin vencimiento (el producto puede tener el suyo).
-- ============================================================
ALTER TABLE public.packing_batches ADD COLUMN IF NOT EXISTS expires_at date;

COMMENT ON COLUMN public.packing_batches.expires_at IS
  'Vencimiento del lote: heredado del granel (si tiene) o del chip shelf-life del envasado. NULL = sin vencimiento.';