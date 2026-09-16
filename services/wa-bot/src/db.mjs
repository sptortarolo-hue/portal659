import pg from "pg";
import { config } from "./config.mjs";

let pool = null;

export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) throw new Error("DATABASE_URL no configurado");
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
    });
    pool.on("error", () => {});
  }
  return pool;
}

export async function queryOne(sql, params = []) {
  const { rows } = await getPool().query(sql, params);
  return rows[0] || null;
}

export async function query(sql, params = []) {
  await getPool().query(sql, params);
}

/** token (vendor_wa_bots.token) → vendor. Devuelve null si no hay. */
export async function vendorByToken(token) {
  if (!token) return null;
  return queryOne(
    `SELECT v.id, v.store_name, v.vertical, vb.wa_phone, vb.enabled, vb.status
     FROM vendor_wa_bots vb
     JOIN vendors v ON v.id = vb.vendor_id
     WHERE vb.token = $1 LIMIT 1`,
    [token]
  );
}