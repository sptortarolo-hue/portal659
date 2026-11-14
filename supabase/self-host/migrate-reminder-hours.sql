-- Migración: recordatorios por WhatsApp configurables por comercio
-- (horarios + texto editable). Tolerante: si no se aplica, se usan defaults.

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reminder_t24_enabled boolean DEFAULT true;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reminder_t24_hour integer DEFAULT 18;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reminder_t2_enabled boolean DEFAULT true;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reminder_t2_hours integer DEFAULT 2;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reminder_t24_text text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reminder_t2_text text;

-- Validar rangos (best-effort).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_reminder_t24_hour_check') THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_reminder_t24_hour_check CHECK (reminder_t24_hour IS NULL OR (reminder_t24_hour >= 0 AND reminder_t24_hour <= 23));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_reminder_t2_hours_check') THEN
    ALTER TABLE vendors ADD CONSTRAINT vendors_reminder_t2_hours_check CHECK (reminder_t2_hours IS NULL OR (reminder_t2_hours >= 1 AND reminder_t2_hours <= 24));
  END IF;
END $$;
