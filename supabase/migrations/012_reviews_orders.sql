-- Reviews (reseñas con estrellas)
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID,
  customer_id UUID,
  customer_name TEXT NOT NULL,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_vendor ON reviews(vendor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cualquiera puede leer reseñas" ON reviews FOR SELECT USING (true);
CREATE POLICY "Usuarios autenticados pueden insertar reseñas" ON reviews FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Pedidos: agregar customer_id para que el comprador pueda ver sus pedidos
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id UUID;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
