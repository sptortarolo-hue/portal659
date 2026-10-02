-- Bloqueo de mesa por ventana de turno (estilo Fudo): la mesa solo se
-- bloquea dentro de [reserved_at - lead, reserved_at + tolerancia].
-- Fuera de esa ventana opera normal (walk-ins incluidos).

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS duration_min integer NOT NULL DEFAULT 120;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_duration_check'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_duration_check
      CHECK (duration_min >= 15 AND duration_min <= 720);
  END IF;
END $$;

-- Nuevo estado "ausente" (no vino): libera la mesa dejando registro.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_status_check'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
      CHECK (status IN ('pendiente', 'sentada', 'cancelada', 'ausente'));
  END IF;
END $$;

-- Ventana configurable por comercio (defaults estilo Fudo: 15/15).
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reservation_lead_min integer NOT NULL DEFAULT 15;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reservation_tolerance_min integer NOT NULL DEFAULT 15;

-- El bloqueo pasa a derivarse de las ventanas: se libera cualquier mesa que
-- haya quedado marcada como reservada con el modelo anterior.
UPDATE tables SET status = 'libre' WHERE status = 'reservada';
