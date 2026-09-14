import { Redis } from "@upstash/redis";
import { config } from "./config.mjs";

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