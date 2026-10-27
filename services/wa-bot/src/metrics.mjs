// @ts-check

/** @typedef {{ inbound: number[]; handoffs: number[]; lastSeen: number }} VendorMetrics */
/** @typedef {{ ts: number; vendorId: string | null; store: string; kind: string; waId: string; text: string }} FeedEvent */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TS = 2000;   // tope de timestamps por contador (podado al vuelo)
const FEED_MAX = 120;  // tope del ring buffer

/** @type {Map<string, VendorMetrics>} */
const vendors = new Map();
/** @type {FeedEvent[]} */
const feed = [];           // más nuevo primero

/**
 * @param {string | number} vendorId
 * @returns {VendorMetrics}
 */
function rec(vendorId) {
  let r = vendors.get(String(vendorId));
  if (!r) {
    r = { inbound: [], handoffs: [], lastSeen: 0 };
    vendors.set(String(vendorId), r);
  }
  return r;
}

/** @param {number[]} arr */
function pruneTs(arr) {
  const cutoff = Date.now() - DAY_MS;
  while (arr.length && arr[0] < cutoff) arr.shift();
  if (arr.length > MAX_TS) arr.splice(0, arr.length - MAX_TS);
}

/** @param {number[]} arr @param {number} ts */
function pushTs(arr, ts) {
  pruneTs(arr);
  arr.push(ts);
}

/** @param {number[]} arr @param {number} ms @returns {number} */
function countSince(arr, ms) {
  const cutoff = Date.now() - ms;
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] < cutoff) break;
    n++;
  }
  return n;
}

/**
 * Registra un evento en el feed (más nuevo primero, tope FEED_MAX).
 * @param {{ vendorId?: string | number | null; store?: string; kind?: string; waId?: string; text?: string }} opts
 */
export function feedPush(opts) {
  const { vendorId = null, store = "", kind = "system", waId = "", text = "" } = opts || {};
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

/**
 * Marca la última señal viva del comercio (mensaje del relay, conexión, QR).
 * @param {string | number} vendorId
 */
export function touchLastSeen(vendorId) {
  rec(vendorId).lastSeen = Date.now();
}

/**
 * Mensaje entrante del cliente (⬅️) — cuenta + feed.
 * @param {string | number} vendorId
 * @param {string} store
 * @param {string} waId
 * @param {string} text
 */
export function bumpInbound(vendorId, store, waId, text) {
  const r = rec(vendorId);
  r.lastSeen = Date.now();
  pushTs(r.inbound, Date.now());
  feedPush({ vendorId, store, kind: "in", waId, text });
}

/**
 * Handoff a persona (🙋): el bot derivó el hilo al dueño.
 * @param {string | number} vendorId
 * @param {string} store
 * @param {string} waId
 * @param {string} text
 */
export function bumpHandoff(vendorId, store, waId, text) {
  const r = rec(vendorId);
  pushTs(r.handoffs, Date.now());
  feedPush({ vendorId, store, kind: "handoff", waId, text });
}

/**
 * Informe de contadores del comercio (para /bots del cerebro).
 * @param {string | number} vendorId
 * @returns {{ inboundHour: number; inboundDay: number; handoffsHour: number; handoffsDay: number; lastSeen: number | null }}
 */
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

/**
 * Feed para GET /feed (por defecto completo).
 * @param {number} [limit]
 * @returns {FeedEvent[]}
 */
export function feedList(limit = FEED_MAX) {
  const n = Math.max(1, Math.min(Number(limit) || FEED_MAX, FEED_MAX));
  return feed.slice(0, n);
}
