// @ts-check
// Idempotencia de mensajes entrantes: evita procesar dos veces el mismo mensaje
// cuando Meta reintenta el webhook (o el relay reenvía tras una caída).
// Patrón espejo de limits.mjs: Redis si está configurado, si no memoria del
// proceso con TTL de 5 minutos (suficiente para cubrir retries de Meta).
import { Redis } from "@upstash/redis";
import { config } from "./config.mjs";

const TTL_SEC = 5 * 60; // 5 minutos
const memory = new Map(); // msgId -> expireAt (ms)

let redis = null;
function getRedis() {
  if (redis) return redis;
  if (config.redisUrl && config.redisToken) {
    redis = new Redis({ url: config.redisUrl, token: config.redisToken });
    return redis;
  }
  return null;
}

function pruneMemory() {
  const now = Date.now();
  for (const [k, exp] of memory) {
    if (exp < now) memory.delete(k);
  }
}

/**
 * ¿Ya procesamos este mensaje? Devuelve true si es un duplicado (retry).
 * @param {string} msgId ID del mensaje en WhatsApp (m.Info.ID del relay).
 * @returns {Promise<boolean>}
 */
export async function isDuplicate(msgId) {
  if (!msgId) return false; // sin ID no podemos deduplicar: procesar normal
  const key = `wa:dedup:${msgId}`;
  const r = getRedis();
  if (r) {
    try {
      const exists = await r.get(key);
      if (exists) return true;
      await r.set(key, "1", { ex: TTL_SEC });
      return false;
    } catch {
      // Redis caído: caer a memoria
    }
  }
  pruneMemory();
  const now = Date.now();
  if (memory.has(msgId) && memory.get(msgId) > now) return true;
  memory.set(msgId, now + TTL_SEC * 1000);
  return false;
}
