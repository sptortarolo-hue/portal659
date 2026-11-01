/**
 * Token de admin para el panel LOCAL (solo dev).
 * Uso: node scripts/dev-admin-token.mjs [--revert]
 *
 * Promocio temporalmente un perfil local a is_admin para poder abrir
 * /admin en el navegador. Con --revert lo deja como estaba.
 *
 * SEGURIDAD: solo funciona contra una base local (localhost/127.0.0.1).
 * Si la DATABASE_URL apunta a otro lado, aborta: promover un usuario en
 * producción sería un agujero de admin.
 */
import { createRequire } from "module";
import { readFileSync } from "node:fs";
const req = createRequire("C:/xx/conectaMOS-v2/package.json");
const { SignJWT } = req("jose");
const { Client } = req("pg");

const env = {};
for (const f of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync("C:/xx/conectaMOS-v2/" + f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

// Sólo base local.
const host = (() => {
  try {
    return new URL(env.DATABASE_URL).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`ABORTA: la base ${host} no es local. Este script sólo promoción local.`);
  process.exit(1);
}

const db = new Client({ connectionString: env.DATABASE_URL });
await db.connect();

if (process.argv.includes("--revert")) {
  // Se promueve siempre el primer perfil por antigüedad: el revert usa el mismo.
  const { rows } = await db.query(
    "SELECT id FROM profiles ORDER BY created_at LIMIT 1",
  );
  if (rows.length) {
    await db.query("UPDATE profiles SET is_admin = false WHERE id = $1", [rows[0].id]);
  }
  console.log("revertido");
  await db.end();
  process.exit(0);
}

const { rows } = await db.query(
  "SELECT id, email, full_name, role, token_version FROM profiles ORDER BY created_at LIMIT 5",
);
if (!rows.length) {
  console.log("no hay perfiles locales");
  await db.end();
  process.exit(1);
}
const u = rows[0];
await db.query("UPDATE profiles SET is_admin = true WHERE id = $1", [u.id]);
console.error("promovido temporalmente:", u.email);

const secret = new TextEncoder().encode(env.JWT_SECRET);
const token = await new SignJWT({
  sub: u.id,
  email: u.email,
  role: u.role,
  tv: u.token_version ?? 1,
})
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(secret);
await db.end();
console.log(token);
