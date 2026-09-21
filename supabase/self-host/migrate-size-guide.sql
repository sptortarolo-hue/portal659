-- ============================================================
-- Fase A vertical moda: guía de talles + fotos por color
-- ============================================================
-- 1) products.size_guide: guía de talles por producto (texto libre,
--    una línea por talle: "M: Pecho 96 cm · Largo 69 cm"). NULL = sin guía
--    (la ficha muestra las plantillas por categoría, ver src/lib/size-guides.ts).
ALTER TABLE products ADD COLUMN IF NOT EXISTS size_guide text;

-- 2) product_images.color: asocia cada foto extra de la galería a un color de
--    variante (NULL = foto general del producto). El selector de color de la
--    ficha cambia la foto principal a la primera foto de ese color.
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color text;
