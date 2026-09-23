"use client";

import { useOnlineStatus, usePendingSyncCount } from "@/hooks/use-online-status";

/**
 * Banner global de estado offline (Track Ventas F1).
 * - Sin conexión: avisa que las ventas se guardan en el equipo + pendientes.
 * - Online con pendientes: aviso sutil de sincronización en curso.
 * - Online sin pendientes: no renderiza nada.
 */
export function OfflineBanner({ vendorId }: { vendorId: string | null | undefined }) {
  const online = useOnlineStatus();
  const pending = usePendingSyncCount(vendorId);

  if (online && pending === 0) return null;

  if (!online) {
    return (
      <div
        role="status"
        className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        📡 Sin conexión — las ventas se guardan en este equipo y se sincronizan al reconectar
        {pending > 0 && (
          <span className="ml-1 font-bold tabular-nums">
            ({pending} pendiente{pending === 1 ? "" : "s"})
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
    >
      🔄 Sincronizando {pending} acción{pending === 1 ? "" : "es"} pendiente{pending === 1 ? "" : "s"}…
    </div>
  );
}
