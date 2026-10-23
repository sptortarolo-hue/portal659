-- ============================================================
-- Crear el primer usuario administrador de Portal 659
-- Ejecutar UNA VEZ en el Postgres del VPS después de aplicar schema.sql.
--
-- Reemplazá los valores entre <> ANTES de ejecutar:
--   <EMAIL_ADMIN>, <HASH_DEL_PASSWORD>, <NOMBRE_ADMIN>
--
-- Para generar el HASH del password con argon2id podés usar /api/admin/setup
-- o ejecutar el comando seed de Node. Si usás este SQL, generá el hash con:
--   npx tsx -e "import { hashPassword } from './src/lib/auth'; hashPassword('TU_PASSWORD').then(console.log)"
--
-- Las contraseñas NUNCA se guardan en texto plano.
-- ============================================================

-- 1) Insertar el perfil admin (email_confirmed = true, role = 'vendor')
INSERT INTO public.profiles (email, password_hash, full_name, role, email_confirmed, verified)
VALUES ('<EMAIL_ADMIN>', '<HASH_DEL_PASSWORD>', '<NOMBRE_ADMIN>', 'vendor', true, true)
ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  full_name = EXCLUDED.full_name,
  role = 'vendor',
  email_confirmed = true,
  verified = true;

-- 2) Portal 659 no tiene tienda propia: el admin gestiona otros comercios
--    mediante impersonación (admin-as). No se crea vendor fantasma.