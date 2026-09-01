-- Costo de delivery por comercio
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS delivery_fee numeric(10, 2);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS free_delivery_min numeric(10, 2);