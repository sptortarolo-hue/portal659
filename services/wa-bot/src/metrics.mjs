// Telemetría en memoria del cerebro (fase 1 del tablero del admin):
//  - contadores por comercio (mensajes entrantes, handoffs) en ventanas hora/día
//  - "última señal" por comercio (latido del relay)
//  - feed de eventos (ring buffer) para el feed en vivo del tablero
// Todo vive en el proceso: un deploy lo reinicia (la historia diaria es fase 2).
// Patrón espejo de limits.mjs: sin dependencias, importable desde bot.mjs y tests.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TS = 2000;   // tope de timestamps por contador (podado al vuelo)
const FEED_MAX = 120;  // tope del ring buffer

const vendors = new Map(); // vendorId -> { inbound: number[], handoffs: number[], lastSeen: ts }
const feed = [];           // [{ ts, vendorId, store, kind, waId, text }] — más nuevo primero

function rec(vendorId) {
  let r = vendors.get(String(vendorId));
  if (!r) {
    r = { inbound: [], handoffs: [], lastSeen: 0 };
    vendors.set(String(vendorId), r);
  }
  return r;
}

function pruneTs(arr) {
  const cutoff = Date.now() - DAY_MS;
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length > MAX_TS) arr.splice(0, arr.length - MAX_TS);
}

function pushTs(arr, ts) {
  pruneTs(arr);
  arr.push(ts);
}

function countSince(arr, ms) {
  const cutoff = Date.now() - ms;
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] < cutoff) break;
    n++;
  }
  return n;
}

/** Registra un evento en el feed (más nuevo primero, tope FEED_MAX). */
export function feedPush({ vendorId = null, store = "", kind = "system", waId = "", text = "" }) {
  feed.unshift({
    ts: Date.now(),
    vendorId: vendorId ? String(vendorId) : null,
    store: String(store || ""),
    kind: String(kind),
    waId: String(waId || "").replace(/@.*/, ""),
    text: String(text || "").slice(0, 160),
  });
  if (feed.length > FEED_MAX) feed.length = FEED_MAX;
}

/** Marca la última señal viva del comercio (mensaje del relay, conexión, QR). */
export function touchLastSeen(vendorId) {
  rec(vendorId).lastSeen = Date.now();
}

/** Mensaje entrante del cliente (⬅️) — cuenta + feed. */
export function bumpInbound(vendorId, store, waId, text) {
  const r = rec(vendorId);
  r.lastSeen = Date.now();
  pushTs(r.inbound, Date.now());
  feedPush({ vendorId, store, kind: "in", waId, text });
}

/** Handoff a persona (🙋): el bot derivó el hilo al dueño. */
export function bumpHandoff(vendorId, store, waId, text) {
  const r = rec(vendorId);
  pushTs(r.handoffs, Date.now());
  feedPush({ vendorId, store, kind: "handoff", waId, text });
}

/** Informe de contadores del comercio (para /bots del cerebro). */
export function metricsReport(vendorId) {
  const r = vendors.get(String(vendorId)) || { inbound: [], handoffs: [], lastSeen: 0 };
  return {
    inboundHour: countSince(r.inbound, HOUR_MS),
    inboundDay: countSince(r.inbound, DAY_MS),
    handoffsHour: countSince(r.handoffs, HOUR_MS),
    handoffsDay: countSince(r.handoffs, DAY_MS),
    lastSeen: r.lastSeen || null,
  };
}

/** Feed para GET /feed (por defecto completo). */
export function feedList(limit = FEED_MAX) {
  const n = Math.max(1, Math.min(Number(limit) || FEED_MAX, FEED_MAX));
  return feed.slice(0, n);
}
