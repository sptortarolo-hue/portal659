"use client";

import { useEffect, useRef } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Registra la suscripción a notificaciones push cuando el usuario está logueado.
 * Best-effort: nunca falla la app.
 */
export function PushSubscribe() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    async function init() {
      try {
        const [meRes, configRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/push/config"),
        ]);
        const me = await meRes.json();
        const config = await configRes.json();

        // Solo suscribir si hay sesión y hay clave VAPID pública
        if (!me.user || !config.vapidPublicKey) return;

        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        if (!registration) return;

        const existing = await registration.pushManager.getSubscription();
        if (existing) return; // ya suscripto

        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) as BufferSource,
        });

        const raw = JSON.parse(JSON.stringify(subscription));
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: raw.endpoint,
            p256dh: raw.keys?.p256dh || "",
            auth: raw.keys?.auth || "",
          }),
        });
      } catch {
        // Best-effort: no hacer nada si falla
      }
    }

    done.current = true;
    init();
  }, []);

  return null;
}