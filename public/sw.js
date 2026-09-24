// v15: + doc-cache SOLO para navegaciones /vendor/* (network-first).
// Motivo: recargar el panel sin red debe bootear (F6 bootstrap desde
// snapshot); sin documento cacheado el reload cae a offline.html y el
// modo offline exige pestaña ya abierta. Seguro contra HTML viejo:
// - Online SIEMPRE gana la red (el fallback solo se sirve si fetch tira).
// - Tras un deploy hay red por definición → HTML fresco.
// - Si el HTML cacheado referencia chunks ausentes, la app muestra su
//   ErrorBoundary (no pantalla muerta). Nunca se precachea ni se sirve
//   teniendo red (lección v12/v13). Purga v14. Otros paths: sin cambios.
const CACHE_NAME = "portal659-v15";
const API_CACHE = "portal659-api-v15";
const DOC_CACHE = "portal659-doc-v15";
const CURRENT_CACHES = new Set([CACHE_NAME, API_CACHE, DOC_CACHE]);
const OFFLINE_URL = "/offline.html";

// GETs vendor cacheables (prefijos de pathname, mismo origen).
const CACHEABLE_API_PREFIXES = [
  "/api/vendor/me",
  "/api/vendor/offers",
  "/api/vendor/categories",
  "/api/vendor/modifiers",
  "/api/vendor/tables",
  "/api/vendor/orders",
  "/api/subscriptions/me",
];

function isCacheableApi(url) {
  if (url.origin !== self.location.origin) return false;
  // Nunca tokens/sesión.
  if (url.pathname.startsWith("/api/auth/")) return false;
  return CACHEABLE_API_PREFIXES.some(
    (p) => url.pathname === p || url.pathname.startsWith(p + "/")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([
        OFFLINE_URL,
        "/icon.svg",
      ]).catch(() => {})
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => !CURRENT_CACHES.has(name))
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("push", (event) => {
  let data = { title: "Portal 659", body: "Tienes una notificación", icon: "/icons/icon-192.png", tag: "portal659" };
  try {
    if (event.data) {
      const json = event.data.json();
      data = { ...data, ...json };
    }
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      tag: data.tag,
      badge: "/icons/icon-192.png",
      data: { url: data.link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;
  // APIs vendor cacheables: network-first con fallback a caché (offline).
  // El resto de /api/ sigue sin interceptarse (webhooks, mutaciones, auth).
  let apiFallback = null;
  try {
    const url = new URL(request.url);
    if (url.pathname.includes("/api/") && !isCacheableApi(url)) return;
    if (isCacheableApi(url)) apiFallback = true;
  } catch {
    return;
  }
  if (!apiFallback && request.url.includes("/_next/")) return;
  // Bypass total de fotos: ni siquiera se interceptan (ver nota v13).
  try {
    if (new URL(request.url).pathname.startsWith("/uploads/")) return;
  } catch {
    return;
  }

  if (apiFallback) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const ct = networkResponse.headers.get("content-type") || "";
          if (networkResponse.status === 200 && ct.includes("application/json")) {
            const cache = await caches.open(API_CACHE);
            cache.put(request, networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response(JSON.stringify({ error: "Sin conexión" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      })()
    );
    return;
  }

  // Documento del panel vendor (F6): network-first. Con red, siempre fresco
  // (tras un deploy hay red por definición). Sin red, el HTML cacheado
  // permite bootear el dashboard desde el snapshot de IndexedDB.
  let docFallback = false;
  try {
    const url = new URL(request.url);
    if (
      request.mode === "navigate" &&
      url.origin === self.location.origin &&
      url.pathname.startsWith("/vendor/")
    ) {
      docFallback = true;
    }
  } catch {
    docFallback = false;
  }
  if (docFallback) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const ct = networkResponse.headers.get("content-type") || "";
          if (networkResponse.status === 200 && ct.includes("text/html")) {
            const cache = await caches.open(DOC_CACHE);
            cache.put(request, networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        } catch {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          const offlineResponse = await caches.match(OFFLINE_URL);
          if (offlineResponse) return offlineResponse;
          return new Response("Offline", { status: 503, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // /admin: nunca cachear el documento. Referencia hashes de chunks que rotan
  // en cada deploy; un HTML cacheado = ChunkLoadError / pantalla congelada.
  // Solo red: si la red falla, que lo maneje la app (no HTML viejo).
  // Lo mismo vale para TODA navegación pública (las fotos ya ni se
  // interceptan: bypass total v13).
  let cacheable = true;
  try {
    const url = new URL(request.url);
    if (request.mode === "navigate" || url.pathname.startsWith("/admin")) {
      cacheable = false;
    }
  } catch {
    cacheable = false;
  }

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(request);
        if (cacheable && networkResponse && networkResponse.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone()).catch(() => {});
        }
        return networkResponse;
      } catch {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        if (request.mode === "navigate") {
          const offlineResponse = await caches.match(OFFLINE_URL);
          if (offlineResponse) return offlineResponse;
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })()
  );
});
