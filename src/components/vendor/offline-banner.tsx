"use client";

import { useState } from "react";
import { useOnlineStatus, usePendingPrintsCount, usePendingSyncCount } from "@/hooks/use-online-status";
import { flushPendingPrints } from "@/lib/local-print";
import { ageLabel } from "@/lib/offline-plan";
import { useToast } from "@/lib/toast";

/**
 * Banner global de estado offline (Track Ventas F1/F4/F6 + Impresión F1).
 * - Sin conexión: avisa que las ventas se guardan en el equipo + pendientes.
 *   Si el dashboard booteó desde snapshot (F6), indica la edad de los datos.
 * - Online con pendientes: aviso sutil de sincronización en curso.
 * - Trabajos de impresión en cola: botón manual "Imprimir pendientes" (la
 *   reimpresión nunca es automática: evita duplicar comandas en cocina).
 * - Online sin pendientes: no renderiza nada.
 */
export function OfflineBanner({
  vendorId,
  snapshotAt = null,
}: {
  vendorId: string | null | undefined;
  /** Timestamp del snapshot si el dashboard booteó offline (F6). */
  snapshotAt?: number | null;
}) {
  const online = useOnlineStatus();
  const pending = usePendingSyncCount(vendorId);
  const pendingPrints = usePendingPrintsCount(vendorId);
  const { addToast } = useToast();
  const [flushing, setFlushing] = useState(false);

  const flushPrints = async () => {
    if (!vendorId || flushing) return;
    setFlushing(true);
    try {
      const r = await flushPendingPrints(vendorId);
      if (r.printed > 0) addToast(`🖨️ ${r.printed} documento${r.printed === 1 ? "" : "s"} impreso${r.printed === 1 ? "" : "s"}`, "success");
      if (r.failed > 0) addToast(`⚠️ ${r.failed} no salieron: ${r.errors[0] || "impresora no disponible"}`, "error");
      if (r.printed === 0 && r.failed === 0) addToast("Nada para imprimir (los pendientes aún no sincronizan)", "info");
    } finally {
      setFlushing(false);
    }
  };

  if (online && pending === 0 && pendingPrints === 0) return null;

  return (
    <div className="space-y-1.5">
      {(!online || pending > 0) && (
        <div
          role="status"
          className={
            !online
              ? "rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              : "rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
          }
        >
          {!online ? (
            <>
              📡 Sin conexión — las ventas se guardan en este equipo y se sincronizan al reconectar
              {typeof snapshotAt === "number" && (
                <span className="ml-1">(datos guardados {ageLabel(Date.now() - snapshotAt)})</span>
              )}
              {pending > 0 && (
                <span className="ml-1 font-bold tabular-nums">
                  ({pending} pendiente{pending === 1 ? "" : "s"})
                </span>
              )}
            </>
          ) : (
            <>🔄 Sincronizando {pending} acción{pending === 1 ? "" : "es"} pendiente{pending === 1 ? "" : "s"}…</>
          )}
        </div>
      )}
      {online && pendingPrints > 0 && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium"
        >
          <span className="flex-1">
            🖨️ {pendingPrints} documento{pendingPrints === 1 ? "" : "s"} en cola de impresión
          </span>
          <button
            onClick={flushPrints}
            disabled={flushing}
            className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {flushing ? "Imprimiendo…" : "Imprimir ahora"}
          </button>
        </div>
      )}
    </div>
  );
}
