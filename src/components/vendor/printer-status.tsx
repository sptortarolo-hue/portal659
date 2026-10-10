"use client";

import { useEffect, useState } from "react";
import type { Vendor } from "@/types/database";

type St = "ok" | "warn" | "error" | "off" | "none";

const DOT: Record<St, string> = {
  ok: "🟢",
  warn: "🟠",
  error: "🟠",
  off: "🔴",
  none: "⚪",
};

/** Recencia máxima para considerar una desconexión como "reconectando" (vs. muerta). */
const RECONNECT_WINDOW_MS = 3 * 60 * 1000;

/**
 * Indicador de estado de impresora en el header del dashboard.
 * - Modo app (relay): verde si la app Portal Print está conectada.
 * - Modo server (TCP): verde si hay IP configurada y la última impresión fue ok.
 * Al tocarlo lleva a la sección Impresora del Config.
 */
export function PrinterStatus({ vendor, onOpenConfig }: { vendor: Vendor; onOpenConfig: () => void }) {
  const [state, setState] = useState<St>("none");
  // Cola pendiente (modo app): para distinguir "reconectando" (ámbar) de
  // "muerta" (rojo). La recencia se evalúa al momento del poll.
  const [queued, setQueued] = useState(0);

  const mode = vendor.print_mode === "app" ? "app" : "server";

  useEffect(() => {
    let mounted = true;
    async function poll() {
      try {
        const res = await fetch("/api/vendor/print/status");
        if (!res.ok) return;
        const data = await res.json();
        if (!mounted) return;
        if (mode === "app") {
          const online = data?.agent?.online === true;
          const q = Number(data?.agent?.queued) || 0;
          const rawSeen = data?.agent?.lastSeen as number | string | null | undefined;
          const seenMs =
            typeof rawSeen === "number" && Number.isFinite(rawSeen)
              ? rawSeen
              : typeof rawSeen === "string" && rawSeen
                ? new Date(rawSeen).getTime()
                : NaN;
          setQueued(q);
          if (online) {
            setState("ok");
          } else if (q > 0 || (Number.isFinite(seenMs) && Date.now() - seenMs < RECONNECT_WINDOW_MS)) {
            // Se la vio hace poco y/o hay trabajos esperando entrega:
            // casi seguro vuelve sola (backoff), no es una muerte.
            setState("warn");
          } else {
            setState("off");
          }
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
      : state === "warn"
        ? `Reconectando${queued > 0 ? ` (${queued} en cola)` : ""}`
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
      <span>🖨️</span>
      <span>{DOT[state]}</span>
      {state === "warn" && queued > 0 && (
        <span className="text-[10px] font-bold tabular-nums">{queued}</span>
      )}
    </button>
  );
}
