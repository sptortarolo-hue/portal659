import { Redis } from "@upstash/redis";
import { config } from "./config.mjs";
import { query, queryOne } from "./db.mjs";

let redis = null;
const memory = new Map();

function getRedis() {
  if (redis) return redis;
  if (config.redisUrl && config.redisToken) {
    redis = new Redis({ url: config.redisUrl, token: config.redisToken });
    return redis;
  }
  return null;
}

const TTL = 60 * 30; // 30 min de inactividad por conversación
const key = (vendorId, waId) => `wa:conv:${vendorId}:${waId}`;

export async function getState(vendorId, waId) {
  const r = getRedis();
  if (r) {
    const raw = await r.get(key(vendorId, waId));
    return raw ? raw : null;
  }
  return memory.get(key(vendorId, waId)) || null;
}

export async function setState(vendorId, waId, state) {
  const r = getRedis();
  if (r) {
    await r.set(key(vendorId, waId), state, { ex: TTL });
  } else {
    memory.set(key(vendorId, waId), state);
  }
}

export async function clearState(vendorId, waId) {
  const r = getRedis();
  if (r) {
    await r.del(key(vendorId, waId));
  } else {
    memory.delete(key(vendorId, waId));
  }
}

// ————— QR de vinculación (guardado en Postgres, TTL por antigüedad 90s) —————
const QR_TTL_MS = 90 * 1000;

export async function saveQrToken(vendorId, data) {
  await query(
    `UPDATE vendor_wa_bots SET qr_data = $1, qr_updated_at = now() WHERE vendor_id = $2`,
    [data, vendorId]
  );
  console.log(`[qr] guardado para vendor ${vendorId}`);
}

export async function getQrToken(vendorId) {
  const row = await queryOne(
    `SELECT qr_data FROM vendor_wa_bots
     WHERE vendor_id = $1 AND qr_updated_at > now() - interval '90 seconds'`,
    [vendorId]
  );
  return row?.qr_data ?? null;
}

export async function clearQrToken(vendorId) {
  await query(
    `UPDATE vendor_wa_bots SET qr_data = NULL, qr_updated_at = NULL WHERE vendor_id = $1`,
    [vendorId]
  );
}

export async function setBotStatus(vendorId, status) {
  await query(
    `UPDATE vendor_wa_bots SET status = $1, updated_at = now() WHERE vendor_id = $2`,
    [status, vendorId]
  );
}