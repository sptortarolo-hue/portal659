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

let inFlight = false;

/**
 * Asegura la suscripción push de este celu en el servidor. Es idempotente
 * (el endpoint hace upsert por endpoint) así que refrescar de más no duele:
 * repara user_id/keys si cambiaron y recrea la suscripción si el navegador
 * la limpió. Best-effort: nunca falla la app.
 */
export async function ensurePushSubscription(): Promise<void> {
  if (inFlight) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  inFlight = true;
  try {
    const [meRes, configRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/push/config"),
    ]);
    const me = await meRes.json().catch(() => ({}));
    const config = await configRes.json().catch(() => ({}));

    // Solo suscribir si hay sesión y hay clave VAPID pública
    if (!me.user || !config.vapidPublicKey) return;

    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    if (!registration) return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey) as BufferSource,
      });
    }

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
  } finally {
    inFlight = false;
  }
}

/**
 * Registra y mantiene la suscripción a notificaciones push.
 * - Al montar (login con permiso ya dado).
 * - Cuando se otorga el permiso después (evento "portal:ensure-push",
 *   disparado por el botón Probar alerta).
 * - Al volver a la pestaña (repara suscripciones que el navegador limpió).
 */
export function PushSubscribe() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void ensurePushSubscription();

    const onEnsure = () => {
      void ensurePushSubscription();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void ensurePushSubscription();
    };
    window.addEventListener("portal:ensure-push", onEnsure);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("portal:ensure-push", onEnsure);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
