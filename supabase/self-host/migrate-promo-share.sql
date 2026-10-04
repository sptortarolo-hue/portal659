-- Promos para grupos de WhatsApp: imagen personalizada por comercio.
-- El comercio puede subir una foto específica para la OG preview de la promo.
-- Si no sube, se usa la imagen de la tienda con badge "PROMO".

CREATE TABLE IF NOT EXISTS vendor_promo_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_promo_images_vendor_idx ON vendor_promo_images(vendor_id);

-- Un solo registro por comercio (la última imagen subida es la vigente)
CREATE UNIQUE INDEX IF NOT EXISTS vendor_promo_images_vendor_unique ON vendor_promo_images(vendor_id);
