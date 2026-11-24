// @ts-nocheck — pendiente de conversión a TypeScript.
// Modo sandbox para Playground/Laboratorio: el motor corre igual, pero sin
// efectos reales (no envía WhatsApp, no crea pedidos, no registra telemetría).
// AsyncLocalStorage = el flag viaja con el request, no con el proceso (no
// afecta a otros chats que estén siendo atendidos al mismo tiempo).

import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage();

export function runInSandbox(fn) {
  return store.run(true, fn);
}

export function isSandbox() {
  return store.getStore() === true;
}

function stub(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Fetch al app dentro del sandbox. Deja pasar sólo lecturas de catálogo
 * (menú, horarios, banners): nunca escribe ni lee datos de clientes reales.
 */
export async function appFetch(url, options) {
  const u = String(url);
  if (!isSandbox()) return fetch(url, options);
  const method = String(options?.method || "GET").toUpperCase();
  if (method !== "GET") return stub({ ok: true, sandbox: true });
  if (/[?&]phone=|customer|favorites|portal-orders|pending-receipt|latest-orders/.test(u)) {
    return stub({ ok: true, sandbox: true, items: [], orders: [], favorites: [], data: null });
  }
  return fetch(url, options);
}
