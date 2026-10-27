// Telemetría persistente: envía eventos del bot al app (POST /api/wa/events)
// para métricas históricas. Best-effort: no bloquea el flujo del bot.
import { config } from "./config.mjs";

/**
 * Registra un evento del bot en el app (fire-and-forget).
 * @param {string} vendorId
 * @param {string} type - tipo de evento (message_in, message_out, handoff, order_created, etc.)
 * @param {string} [waId] - teléfono del cliente
 * @param {Record<string, any>} [meta] - metadata adicional
 */
export function trackEvent(vendorId, type, waId, meta) {
  if (!vendorId || !type) return;
  try {
    fetch(`${config.appUrl}/api/wa/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.waBotSecret}` },
      body: JSON.stringify({ vendorId, type, waId: waId ? String(waId).replace(/@.*/, "") : undefined, meta: meta || {} }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {});
  } catch { /* best-effort */ }
}
