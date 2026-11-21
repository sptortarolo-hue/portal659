-- Productos sugeribles en el carrito
-- Permite al comercio marcar productos "simples" (sin opciones obligatorias,
-- sin combos, sin grupos de volumen, sin presentaciones huérfanas) como
-- sugeribles en el carrito. Las presentaciones (ej. "Coca 2.25L") son
-- elegibles porque son productos individuales con precio propio.
ALTER TABLE products ADD COLUMN IF NOT EXISTS suggestible boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS suggestible_position int NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_products_suggestible
  ON products (vendor_id, suggestible_position)
  WHERE suggestible = true;
