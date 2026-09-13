// v13: /uploads/* ni se intercepta (bypass total). El browser gestiona la
// foto directo: sus reintentos TLS, su caché `immutable` y sus errores
// nativos. El SW solo mediaba para devolver 503 sintéticos ante fallos
// transitorios (fotos que solo cargaban tras varios F5). Purga cachés v12.
// v12: fotos y navegaciones ya no se cacheaban (HTML pre-deploy = JS muerto).
const CACHE_NAME = "portal659-v13";
const OFFLINE_URL = "/offline.html";

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
          .filter((name) => name !== CACHE_NAME)
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
  if (request.url.includes("/api/")) return;
  if (request.url.includes("/_next/")) return;
  // Bypass total de fotos: ni siquiera se interceptan (ver nota v13).
  try {
    if (new URL(request.url).pathname.startsWith("/uploads/")) return;
  } catch {
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
