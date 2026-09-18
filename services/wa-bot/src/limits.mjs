import { Redis } from "@upstash/redis";
import { config } from "./config.mjs";

// Rate limits por comercio (anti-ban). Patrón espejo de state.mjs: usa Redis si
// está configurado, si no, memoria del proceso. Cada límite es "blando": al
// superarse el bot deja de responder (handoff al dueño) y loguea [ban-risque].

let redis = null;
function getRedis() {
  if (redis) return redis;
  if (config.redisUrl && config.redisToken) {
    redis = new Redis({ url: config.redisUrl, token: config.redisToken });
    return redis;
  }
  return null;
}

const WINDOW_HOUR = 60 * 60;
const WINDOW_DAY = 24 * 60 * 60;
const WINDOW_CHATS = 60 * 60;
const MAX = 500;

const memory = new Map(); // vendorId -> { sentTs: [ts...], newChats: { waId: ts } }

/** Suma 1 a los contadores de mensajes salientes del comercio (hora + día).
 *  Devuelve { hour, day } con los totales de esta ventana. */
export async function countOutbound(vendorId, n = 1) {
  const vendorIdS = String(vendorId);
  const now = Math.floor(Date.now() / 1000);
  const r = getRedis();
  if (r) {
    const hourKey = `wa:out:h:${vendorIdS}:${Math.floor(now / WINDOW_HOUR)}`;
    const dayKey = `wa:out:d:${vendorIdS}:${Math.floor(now / WINDOW_DAY)}`;
    const hour = (await r.incrby(hourKey, n).catch(() => null)) ?? 0;
    const day = (await r.incrby(dayKey, n).catch(() => null)) ?? 0;
    await r.expire(hourKey, WINDOW_HOUR + 60).catch(() => {});
    await r.expire(dayKey, WINDOW_DAY + 60).catch(() => {});
    return { hour, day };
  }
  let rec = memory.get(vendorIdS);
  if (!rec) { rec = { sentTs: [], newChats: new Map() }; memory.set(vendorIdS, rec); }
  const nowMs = Date.now();
  rec.sentTs = rec.sentTs.filter((t) => nowMs - t < WINDOW_HOUR * 1000);
  for (let i = 0; i < n; i++) rec.sentTs.push(nowMs);
  const hour = rec.sentTs.length;
  const dayStart = nowMs - WINDOW_DAY * 1000;
  let day = 0;
  for (const t of rec.sentTs) if (t >= dayStart) day++;
  // Memoria: podar entradas viejas al vuelo (no guardamos más de MAX ts por vendor).
  if (rec.sentTs.length > MAX) rec.sentTs = rec.sentTs.slice(rec.sentTs.length - MAX);
  return { hour, day };
}

/** Marca un chat nuevo (primer contacto de un wa_id) y devuelve cuántos chats
 *  nuevos distintos hay en la ventana de la hora para ese comercio. */
export async function markNewChat(vendorId, waId) {
  const vendorIdS = String(vendorId);
  const waIdS = String(waId);
  const now = Math.floor(Date.now() / 1000);
  const r = getRedis();
  if (r) {
    const chatKey = `wa:chats:${vendorIdS}:${Math.floor(now / WINDOW_CHATS)}`;
    const added = await r.sadd(chatKey, waIdS).catch(() => 0);
    const count = await r.scard(chatKey).catch(() => 0);
    await r.expire(chatKey, WINDOW_CHATS + 60).catch(() => {});
    return { added, count };
  }
  let rec = memory.get(vendorIdS);
  if (!rec) { rec = { sentTs: [], newChats: new Map() }; memory.set(vendorIdS, rec); }
  const seenBefore = rec.newChats.has(waIdS);
  rec.newChats.set(waIdS, now);
  if (rec.newChats.size > MAX) {
    const cutoff = Math.floor(Date.now() / 1000) - WINDOW_CHATS;
    for (const [k, ts] of rec.newChats) if (ts < cutoff) rec.newChats.delete(k);
  }
  const count = [...rec.newChats.values()].filter((ts) => now - ts < WINDOW_CHATS).length;
  return { added: seenBefore ? 0 : 1, count };
}

/** Informe de contadores del comercio (para /health y logs). */
export async function limitsReport(vendorId) {
  const s = String(vendorId);
  const { hour, day } = await countOutbound(s, 0);
  let chats = 0;
  const r = getRedis();
  if (r) {
    const now = Math.floor(Date.now() / 1000);
    chats = await r.scard(`wa:chats:${s}:${Math.floor(now / WINDOW_CHATS)}`).catch(() => 0);
  } else {
    const rec = memory.get(s);
    if (rec) chats = rec.newChats.size;
  }
  return { sentHour: hour, sentDay: day, newChatsHour: chats };
}