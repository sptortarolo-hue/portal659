-- Deduplicación de compras al escanear facturas.
-- El código es tolerante a que esta migración no esté aplicada (sin hash
-- exacto, siguen funcionando las coincidencias por n°/monto/fecha).

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS duplicate_override_reason text;

CREATE INDEX IF NOT EXISTS idx_purchases_vendor_source_hash
  ON public.purchases (vendor_id, source_hash)
  WHERE source_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_vendor_dedupe
  ON public.purchases (vendor_id, supplier_id, purchased_at);
