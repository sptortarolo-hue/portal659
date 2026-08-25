-- Admin: agregar columna is_admin a vendors
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Marcar vendedor1 como admin para testing
UPDATE vendors SET is_admin = true WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'vendedor1@test.com'
);
