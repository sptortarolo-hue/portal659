-- Reservas de mesas (estilo Fudo): la reserva manual pone la mesa en
-- 'reservada'; al sentar pasa a 'ocupada', al cancelar vuelve a 'libre'.

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  table_id uuid REFERENCES tables(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  party_size integer NOT NULL DEFAULT 2,
  reserved_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pendiente',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_status_check'
  ) THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
      CHECK (status IN ('pendiente', 'sentada', 'cancelada'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_vendor_date
  ON reservations (vendor_id, reserved_at);
CREATE INDEX IF NOT EXISTS idx_reservations_table
  ON reservations (table_id) WHERE status = 'pendiente';
