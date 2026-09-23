"use client";

import { useCallback, useEffect, useState } from "react";
import { outboxCount, outboxList, printsList, type OutboxAction } from "@/lib/offline-db";

/** Estado de conectividad global (navigator.onLine + eventos). */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => (typeof navigator === "undefined" ? true : navigator.onLine)
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * Cantidad de acciones pendientes de sincronizar para un vendor
 * (outbox IndexedDB). `scope` filtra por pestaña (pos/mesas) para badges.
 * Se refresca al montar, al volver online y al ganar foco/visibilidad.
 */
export function usePendingSyncCount(
  vendorId: string | null | undefined,
  scope?: "pos" | "mesas" | "orders" | "print"
): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (!vendorId) {
      setCount(0);
      return;
    }
    outboxCount(vendorId, scope).then(setCount).catch(() => {});
  }, [vendorId, scope]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    // El sync engine (F3) y las acciones offline emiten este evento tras mutar.
    window.addEventListener("portal:outbox-changed", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("portal:outbox-changed", refresh);
    };
  }, [refresh]);

  return count;
}

/**
 * Acciones pendientes con error terminal (lastError): necesitan revisión
 * manual (visor de conflictos, F4). Se refresca con los mismos triggers.
 */
export function usePendingSyncErrors(vendorId: string | null | undefined): OutboxAction[] {
  const [errors, setErrors] = useState<OutboxAction[]>([]);
  const refresh = useCallback(() => {
    if (!vendorId) {
      setErrors([]);
      return;
    }
    outboxList(vendorId)
      .then((rows) => setErrors(rows.filter((r) => !!r.lastError)))
      .catch(() => {});
  }, [vendorId]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener("portal:outbox-changed", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener("portal:outbox-changed", refresh);
    };
  }, [refresh]);

  return errors;
}

/**
 * Trabajos de impresión pendientes (no impresos). Para el botón manual
 * "Imprimir pendientes" (la reimpresión nunca es automática).
 */
export function usePendingPrintsCount(vendorId: string | null | undefined): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    if (!vendorId) {
      setCount(0);
      return;
    }
    printsList(vendorId)
      .then((rows) => setCount(rows.filter((r) => !r.printed).length))
      .catch(() => {});
  }, [vendorId]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    window.addEventListener("portal:outbox-changed", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
      window.removeEventListener("portal:outbox-changed", refresh);
    };
  }, [refresh]);

  return count;
}
