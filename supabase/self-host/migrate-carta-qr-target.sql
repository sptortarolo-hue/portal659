-- Destino del QR del cartel imprimible (/vendor/carta-qr).
--
-- "carta"  → el QR lleva a la carta de mesa (/carta/[slug], solo lectura).
-- "tienda" → el QR lleva al micrositio (/tienda/[slug], con carrito/turnos).
-- NULL     → automático según el vertical (servicios/estética/taller/salud → tienda;
--             gastronomía/comercio/moda → carta).
--
-- Idempotente: se puede correr las veces que haga falta.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS carta_qr_target text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendors_carta_qr_target_check'
  ) THEN
    ALTER TABLE public.vendors
      ADD CONSTRAINT vendors_carta_qr_target_check
      CHECK (carta_qr_target IS NULL OR carta_qr_target IN ('carta', 'tienda'));
  END IF;
END $$;

COMMENT ON COLUMN public.vendors.carta_qr_target IS
  'Destino del QR del cartel imprimible: carta (mesa) | tienda (micrositio) | NULL = automático por vertical';
