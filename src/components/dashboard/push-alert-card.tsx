"use client";

import { useCallback, useEffect, useState } from "react";
import {
  playNewOrderAlert,
  resumeAudioContext,
  stopTitleFlash,
  VENDOR_ALERT_VIBRATE,
} from "@/lib/sounds";

type Status = "unknown" | "unsupported" | "granted" | "denied" | "default";

function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Dispara una notificación de prueba por el MISMO camino que el pedido
 * nuevo (Service Worker → sistema operativo). Si esta prueba suena/vibra,
 * el aviso de pedido nuevo también va a sonar con el celu bloqueado.
 */
export async function fireTestAlert(): Promise<NotificationPermission | null> {
  resumeAudioContext();
  playNewOrderAlert();
  stopTitleFlash();
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return permission;
    }
  }
  if (permission !== "granted") return permission;
  // El permiso se dio recién (o ya estaba): asegurar la suscripción en el
  // servidor para que los próximos pedidos lleguen por push.
  try {
    window.dispatchEvent(new Event("portal:ensure-push"));
  } catch {
    /* noop */
  }
  const opts = {
    body: "Si ves y escuchás esto, las alertas andan: el pedido nuevo suena igual, incluso con el celu bloqueado.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: "portal659-test",
    renotify: true,
    requireInteraction: true,
    vibrate: VENDOR_ALERT_VIBRATE,
    data: { url: "/vendor/dashboard" },
  };
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration("/sw.js")) ||
      (await navigator.serviceWorker.ready);
    await reg.showNotification("🔔 Prueba Portal 659", opts);
  } catch {
    try {
      // Fallback: notificación foreground (no suena bloqueado, pero valida permiso).
      new Notification("🔔 Prueba Portal 659", { body: opts.body, icon: opts.icon, tag: opts.tag });
    } catch {
      /* noop */
    }
  }
  return permission;
}

/**
 * Botón compacto para el header de Comanda: prueba sonido + notificación
 * del sistema sin cambiar de pestaña.
 */
export function AlertTestButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fireTestAlert();
        } finally {
          setBusy(false);
        }
      }}
      className="text-xs px-2 py-1.5 rounded-lg font-medium transition-colors bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
      title="Probar alerta: suena el beep y manda una notificación de prueba (mismo camino que el pedido nuevo)"
    >
      {busy ? "…" : "🔔❓"}
    </button>
  );
}

/**
 * Card de estado de alertas para el tab Pedidos: muestra si las
 * notificaciones están activas en este celu, botón de prueba y guía
 * de configuración (clave para que suene con el celu bloqueado).
 */
export function PushAlertCard() {
  const [status, setStatus] = useState<Status>("unknown");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    if (!detectSupport()) {
      setStatus("unsupported");
      return;
    }
    setStatus(Notification.permission as Status);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onTest = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await fireTestAlert();
      if (permission) setStatus(permission as Status);
      else refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (status === "unknown") return null;

  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold">
          {status === "granted"
            ? "✅ Alertas activas en este celu"
            : status === "denied"
              ? "🚫 Notificaciones bloqueadas"
              : status === "unsupported"
                ? "⚠️ Este navegador no soporta push"
                : "🔔 Activá las alertas de pedidos"}
        </span>
        <button
          type="button"
          onClick={onTest}
          disabled={busy || status === "unsupported"}
          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex-shrink-0"
        >
          {busy ? "Probando…" : status === "granted" ? "🔔 Probar alerta" : "🔔 Activar y probar"}
        </button>
      </div>
      {status === "denied" && (
        <p className="text-xs text-muted-foreground">
          El navegador las tiene bloqueadas: abrí Ajustes del celu → Apps/Notificaciones →
          Chrome (o Portal 659) → permitir notificaciones con sonido.
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground/80 hover:underline">
          Cómo hacer que suene con el celu bloqueado
        </summary>
        <ul className="mt-1.5 space-y-1 list-disc pl-4">
          <li>
            <strong>Android:</strong> instalá la app (desde Chrome: ⋮ → “Agregar a pantalla
            principal”, o la app de Play Store), permití notificaciones con sonido y sacá
            Chrome/Portal 659 del ahorro de batería (Ajustes → Batería → sin restricciones).
          </li>
          <li>
            <strong>iPhone:</strong> abrí el portal en Safari → Compartir → “Agregar a inicio”,
            abrí desde ese ícono y aceptá notificaciones. El sonido es el default de iOS.
          </li>
          <li>
            El sonido del aviso es el de notificaciones del sistema (no se puede poner un
            mp3 propio por web). Cada pedido llega como aviso separado y queda fijo hasta
            que lo tocás.
          </li>
        </ul>
      </details>
    </div>
  );
}
