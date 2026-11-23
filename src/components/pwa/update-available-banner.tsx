"use client";

import { useEffect, useState } from "react";

export function UpdateAvailableBanner() {
  const [show, setShow] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").then((reg) => {
      setRegistration(reg);

      // Si ya hay un SW esperando (ej. tab reabierta), mostrar banner.
      if (reg.waiting) setShow(true);

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setShow(true);
          }
        });
      });
    }).catch(() => {});

    // Cuando el nuevo SW toma control, recargar.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] max-w-md w-[calc(100%-2rem)]">
      <div className="bg-card border border-border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
        <span className="text-lg">🔄</span>
        <p className="flex-1 text-sm font-medium">Nueva versión disponible</p>
        <button
          type="button"
          onClick={() => {
            registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
          }}
          className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-xs font-bold hover:opacity-90"
        >
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => setShow(false)}
          className="text-muted-foreground hover:text-foreground text-xs"
          aria-label="Cerrar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
