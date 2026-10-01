"use client";

import { useCallback, useEffect, useState } from "react";

type ShiftInfo = {
  id: string;
  opened_at: string;
  opening_amount: number;
  opened_by: string | null;
  opened_by_name: string | null;
  status: "open" | "closed";
};

type MovementInfo = {
  id: string;
  kind: "ingreso" | "retiro";
  amount: number;
  reason: string;
  created_at: string;
};

/**
 * Estado del turno de caja (apertura + disponible en vivo).
 * Poll cada 30s + refresh al volver a la pestaña. Lo usan la pill del
 * header, el Mostrador y Mesas (switch "exigir caja abierta").
 */
export function useCashShift(enabled = true, pollMs = 30000) {
  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [movements, setMovements] = useState<MovementInfo[]>([]);
  const [disponible, setDisponible] = useState<number | null>(null);
  const [requireOpenShift, setRequireOpenShift] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/cash-closing");
      const d = await res.json().catch(() => null);
      if (res.ok && d && d.summary) {
        setShift(d.shift ?? null);
        setMovements(d.movements ?? []);
        setDisponible(d.disponible ?? null);
        setRequireOpenShift(d.requireOpenShift === true);
      }
    } catch {
      /* sin red: se mantiene el último estado */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    refresh();
    const t = setInterval(refresh, pollMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, pollMs, refresh]);

  return { shift, movements, disponible, requireOpenShift, loading, refresh };
}
