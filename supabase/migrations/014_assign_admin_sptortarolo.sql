-- Asignar rol de admin al usuario sptortarolo@gmail.com
UPDATE vendors SET is_admin = true WHERE user_id IN (
  SELECT id FROM auth.users WHERE email = 'sptortarolo@gmail.com'
);

-- Si el usuario no tiene vendor registrado, crear uno
INSERT INTO vendors (user_id, store_name, slug, vertical, neighborhood, is_admin, verified)
SELECT id, 'Portal 659 Admin', 'admin-portal659', 'gastronomia', 'sicardi', true, true
FROM auth.users
WHERE email = 'sptortarolo@gmail.com'
  AND id NOT IN (SELECT user_id FROM vendors);
