-- Etiquetas de balanza (EAN-13 de medida variable) leídas con el lector de
-- barras del Mostrador.
--
-- `vendors.scale_label_config`: formato con el que la balanza imprime la
--   etiqueta (prefijo, dígitos de PLU, dígitos del valor, si el valor es peso
--   en gramos / peso en kg / importe, decimales y qué hacer con el dígito
--   verificador). NULL = leer etiquetas desactivado (default, como hoy).
-- `products.scale_plu`: código de la balanza para el producto pesable. Si está
--   vacío se usa el SKU como fallback (compatibilidad con quien ya lo cargó
--   en el código de barras).
--
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-scale-labels.sql
--
-- Sin esta migración todo sigue funcionando: el panel muestra el aviso de
-- migración pendiente y el Mostrador ignora las etiquetas (el resto del
-- escaneo por SKU no cambia).

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS scale_label_config jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS scale_plu text;

COMMENT ON COLUMN vendors.scale_label_config IS
  'Formato de etiqueta de balanza (EAN-13 de medida variable): { enabled, prefix, pluDigits, valueDigits, valueKind, decimals, checkDigit }. NULL = desactivado';
COMMENT ON COLUMN products.scale_plu IS
  'PLU / código de balanza del producto pesable (vacío = se usa sku como fallback)';

-- Un PLU no puede apuntar a dos productos del mismo comercio. Se compara
-- normalizado (sin ceros a la izquierda) tal como lo guarda la API.
CREATE UNIQUE INDEX IF NOT EXISTS products_vendor_scale_plu_uniq
  ON products (vendor_id, lower(btrim(scale_plu)))
  WHERE scale_plu IS NOT NULL AND btrim(scale_plu) <> '';
