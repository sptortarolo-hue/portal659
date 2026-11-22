-- Migración: Conciliación bancaria por email
-- Aditiva: no modifica flujos existentes. Solo agrega tablas y columnas nuevas.

-- Tabla de depósitos bancarios detectados
CREATE TABLE IF NOT EXISTS bank_deposits (
  id serial PRIMARY KEY,
  vendor_id int NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  bank text NOT NULL,
  amount numeric(12,2) NOT NULL,
  sender_name text,
  operation_id text,
  received_at timestamptz NOT NULL,
  matched_order_id int REFERENCES orders(id) ON DELETE SET NULL,
  match_confidence text, -- 'exact', 'probable', 'unmatched', 'manual', 'ignored'
  raw_subject text,
  raw_body text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bank, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_deposits_vendor ON bank_deposits(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_unmatched ON bank_deposits(vendor_id) WHERE matched_order_id IS NULL;

-- Columnas nuevas en vendors (aditivas, default false = desactivado)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_conciliation_enabled boolean DEFAULT false;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_conciliation_banks text[] DEFAULT '{}';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_conciliation_voice boolean DEFAULT false;