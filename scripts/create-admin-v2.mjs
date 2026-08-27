// Crear el primer usuario administrador de Portal 659.
// Uso (desde la raíz del proyecto):
//   node scripts/create-admin-v2.mjs <EMAIL> <PASSWORD> <NOMBRE>
// Requiere DATABASE_URL en el entorno (.env).
// Es idempotente: si el email/slug ya existen, actualiza en vez de duplicar.

import argon2 from "argon2";
import pg from "pg";

const { Pool } = pg;

const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || "Portal 659 Admin";

if (!email || !password) {
  console.error("Uso: node scripts/create-admin-v2.mjs <EMAIL> <PASSWORD> [NOMBRE]");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Falta DATABASE_URL en el entorno");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const profileRes = await client.query(
      `INSERT INTO profiles (email, password_hash, full_name, role, email_confirmed, verified)
       VALUES ($1, $2, $3, 'vendor', true, true)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         role = 'vendor',
         email_confirmed = true,
         verified = true
       RETURNING id`,
      [email.toLowerCase().trim(), passwordHash, name]
    );
    const userId = profileRes.rows[0].id;

    await client.query(
      `INSERT INTO vendors (user_id, store_name, slug, category, vertical, neighborhood, accepting_quotes, verified, is_admin)
       VALUES ($1, $2, 'admin-portal659', 'admin', 'gastronomia', 'sicardi', false, true, true)
       ON CONFLICT (slug) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         store_name = EXCLUDED.store_name,
         is_admin = true,
         verified = true`,
      [userId, name]
    );

    await client.query("COMMIT");
    console.log(`Admin creado/actualizado: ${email} (userId: ${userId})`);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Error:", e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();