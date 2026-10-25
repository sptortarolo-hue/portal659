-- Pesables: múltiplo de venta y peso mínimo (por comercio).
-- `vendors.weight_step_kg`: 0/NULL = peso libre (default, como hasta hoy).
--   0.25 o 0.5 = el cliente solo carga múltiplos (de a 250 g / 500 g).
-- `vendors.weight_min_kg`: peso mínimo de venta en kg (0/NULL = sin mínimo).
--   Ej: 0.100 kg (100 g) en charcutería, 0.250 kg en verdulería.
-- Reglas de UX (apps análogas): nunca pesos inviables (3 g de queso) — libre
-- pero acotado, con chips de fracciones típicas (1/2 kg, 1 kg).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS weight_step_kg numeric(6,3);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS weight_min_kg numeric(6,3);

COMMENT ON COLUMN vendors.weight_step_kg IS 'Múltiplo de venta en kg para productos pesables (0/NULL = libre)';
COMMENT ON COLUMN vendors.weight_min_kg IS 'Peso mínimo de venta en kg (0/NULL = sin mínimo)';
