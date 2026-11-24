// @ts-nocheck — pendiente de conversión a TypeScript.
// Configuración de agentes leída desde la DB (tabla bot_agents).
// Falla ABIERTO: si no hay DATABASE_URL, la tabla no existe o la query falla,
// devuelve null y el motor decide por slug/env exactamente como antes.

import { queryOne } from "./db.mjs";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { value, at }

export async function getBotConfig(vendorId, isPortal) {
  const key = isPortal ? "portal" : String(vendorId || "");
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = null;
  try {
    const row = await queryOne(
      `SELECT key, vendor_id, name, mode, enabled, tone, greeting, handoff_phone
       FROM bot_agents WHERE key = $1 LIMIT 1`,
      [key]
    );
    if (row) {
      value = {
        key: row.key,
        vendorId: row.vendor_id ? String(row.vendor_id) : null,
        name: row.name,
        mode: row.mode === "orders" ? "orders" : "concierge",
        enabled: row.enabled === true,
        tone: row.tone === "clasico" ? "clasico" : "humano",
        greeting: row.greeting || null,
        handoffPhone: row.handoff_phone || null,
      };
    }
  } catch {
    // tabla ausente / DB caída → fallback al comportamiento histórico
    value = null;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

/** Solo para tests: limpiar cache entre escenarios. */
export function clearBotConfigCache() {
  cache.clear();
}
