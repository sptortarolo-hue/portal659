"use client";

import { useEffect, useState } from "react";
import type { Vendor } from "@/types/database";

type St = "ok" | "error" | "off" | "none";

const DOT: Record<St, string> = {
  ok: "🟢",
  error: "🟠",
  off: "🔴",
  none: "⚪",
};

/**
 * Indicador de estado de impresora en el header del dashboard.
 * - Modo app (relay): verde si la app Portal Print está conectada.
 * - Modo server (TCP): verde si hay IP configurada y la última impresión fue ok.
 * Al tocarlo lleva a la sección Impresora del Config.
 */
export function PrinterStatus({ vendor, onOpenConfig }: { vendor: Vendor; onOpenConfig: () => void }) {
  const [state, setState] = useState<St>("none");

  const mode = (vendor as any).print_mode === "app" ? "app" : "server";

  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch("/api/vendor/print/status");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        if (mode === "app") {
          setState(data?.agent?.online ? "ok" : "off");
        } else {
          const hasIp = !!data?.vendor?.printer_ip;
          if (!hasIp) setState("none");
          else if (data?.vendor?.last_print_ok === false) setState("error");
          else setState("ok");
        }
      } catch {
        /* noop */
      }
    }
    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vendor?.id]);

  const label =
    state === "ok"
      ? "Impresora"
      : state === "error"
        ? "Falla última"
        : state === "off"
          ? "Sin conexión"
          : "Sin impresora";

  return (
    <button
      type="button"
      onClick={onOpenConfig}
      title={`Estado de impresora: ${label}. Tocá para configurar.`}
      className="flex-shrink-0 flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
    >
      <span>{DOT[state]}</span>
      <span className="hidden sm:inline">🖨️</span>
    </button>
  );
}
