import { Redis } from "@upstash/redis";
import { config } from "./config.mjs";

let redis = null;

function getRedisClient() {
  if (redis) return redis;
  if (config.redisUrl && config.redisToken) {
    try {
      redis = new Redis({ url: config.redisUrl, token: config.redisToken });
      return redis;
    } catch {
      return null;
    }
  }
  return null;
}

const memory = new Map();
const KEY = (vendorId) => `wa:learn:${vendorId}`;
const MAX = 12;

export async function loadCorrections(vendorId) {
  const r = getRedisClient();
  if (r) {
    try {
      const raw = await r.get(KEY(vendorId));
      return Array.isArray(raw) ? raw.slice(-MAX) : [];
    } catch {
      return [];
    }
  }
  const entry = memory.get(KEY(vendorId));
  return entry ? entry.slice(-MAX) : [];
}

export async function saveCorrection(vendorId, entry) {
  if (!vendorId || !entry) return;
  const r = getRedisClient();
  const list = await loadCorrections(vendorId);
  list.push({ ...entry, at: Date.now() });
  const trimmed = list.slice(-MAX);
  if (r) {
    try {
      await r.set(KEY(vendorId), trimmed, { ex: 60 * 60 * 24 * 90 });
    } catch {}
  } else {
    memory.set(KEY(vendorId), trimmed);
  }
}

export function formatFewShot(corrections) {
  if (!Array.isArray(corrections) || corrections.length === 0) return "";
  const lines = corrections.map((c, i) => {
    const inp = String(c.customerMsg || "").slice(0, 200);
    const out = c.corrected ? JSON.stringify(c.corrected) : (c.order ? JSON.stringify(c.order) : "");
    return `Ejemplo ${i + 1}:\nCliente: "${inp}"\nPedido correcto: ${out}`;
  });
  return "\n\nEjemplos aprendidos de correcciones anteriores (imita este formato):\n" + lines.join("\n\n");
}
