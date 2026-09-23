"use client";

import { useState } from "react";
import { usePendingSyncErrors } from "@/hooks/use-online-status";
import {
  emitOutboxChanged,
  outboxRemove,
  outboxUpdate,
  type OutboxAction,
} from "@/lib/offline-db";
import { SYNC_COMPLETED_EVENT, syncOutbox } from "@/lib/sync-engine";
import { useToast } from "@/lib/toast";

const TYPE_LABELS: Record<string, string> = {
  pos_order: "Venta de mostrador",
  consumicion: "Consumición de mesa",
  table_close: "Cierre de mesa",
  order_status: "Cambio de estado",
  order_cancel: "Cancelación",
  mark_paid: "Marcar pagado",
};

function labelFor(a: OutboxAction): string {
  return TYPE_LABELS[a.type] ?? a.type;
}

/**
 * Visor de conflictos del sync (F4). Solo visible si hay acciones con error
 * terminal (ej. 409 sin stock tras cobrar en efectivo). Cada ítem permite:
 * - Reintentar: vuelve a la cola y fuerza un drenaje.
 * - Descartar: la acción sale de la cola PERO la plata ya se cobró — queda
 *   un agujero de caja a conciliar manualmente (se avisa explícito).
 */
export function OfflineConflicts({ vendorId }: { vendorId: string | null | undefined }) {
  const errors = usePendingSyncErrors(vendorId);
  const { addToast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);

  if (!vendorId || errors.length === 0) return null;

  const retry = async (a: OutboxAction) => {
    if (a.id == null) return;
    setBusyId(a.id);
    try {
      await outboxUpdate(a.id, { attempts: 0, lastError: null });
      emitOutboxChanged();
      const s = await syncOutbox(vendorId);
      if (s.synced > 0) addToast(`✅ ${labelFor(a)} sincronizada`, "success");
      else if (!s.offline && !s.authError) addToast("Sigue sin sincronizar, revisá el error", "error");
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (a: OutboxAction) => {
    if (a.id == null) return;
    const ok = window.confirm(
      `¿Descartar "${labelFor(a)}"? La venta ya se cobró: va a faltar en el sistema y hay que ajustar la caja manualmente.`
    );
    if (!ok) return;
    setBusyId(a.id);
    try {
      await outboxRemove(a.id);
      emitOutboxChanged();
      // Que los ledgers locales (Mostrador/Mesas) dropeen la entrada.
      try {
        window.dispatchEvent(
          new CustomEvent(SYNC_COMPLETED_EVENT, {
            detail: { mappings: {}, syncedLocalIds: a.localId ? [a.localId] : [] },
          })
        );
      } catch {
        /* noop */
      }
      addToast("Descartada: ajustá la caja, esa venta quedó solo en el equipo", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="alert"
      className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-950/40"
    >
      <p className="text-xs font-semibold text-red-800 dark:text-red-200">
        ⚠️ {errors.length} acción{errors.length === 1 ? "" : "es"} sin sincronizar (requiere revisión)
      </p>
      <div className="mt-1.5 space-y-1.5">
        {errors.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-red-900 dark:text-red-100 truncate">{labelFor(a)}</p>
              <p className="text-red-700/80 dark:text-red-300/80 truncate">
                {a.lastError || "Error desconocido"} ·{" "}
                {new Date(a.createdAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <button
              disabled={busyId === a.id}
              onClick={() => retry(a)}
              className="shrink-0 rounded-lg border border-red-300 bg-white px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-transparent"
            >
              Reintentar
            </button>
            <button
              disabled={busyId === a.id}
              onClick={() => discard(a)}
              className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-100 disabled:opacity-50 dark:hover:bg-red-900/40"
            >
              Descartar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
