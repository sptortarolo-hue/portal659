"use client";

import { useCallback, useEffect, useState } from "react";

export type DeliveryStaffRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string;
  profile_id: string | null;
};

function displayName(s: DeliveryStaffRow): string {
  return s.full_name?.trim() || s.phone?.trim() || "Repartidor";
}

/**
 * Repartidores del comercio para asignación de deliveries.
 * - `byProfile`: profile_id → nombre (el pedido guarda profile id en
 *   `assigned_to`, igual que el claim: así matchea el tablero).
 * - Solo `status === "active"` se puede asignar (vinculado con código).
 */
export function useDeliveryStaff(enabled: boolean): {
  staff: DeliveryStaffRow[];
  byProfile: Record<string, string>;
  loading: boolean;
  reload: () => void;
} {
  const [staff, setStaff] = useState<DeliveryStaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    fetch("/api/vendor/staff")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list: DeliveryStaffRow[] = Array.isArray(d?.staff) ? d.staff : [];
        setStaff(list);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const byProfile: Record<string, string> = {};
  for (const s of staff) {
    if (s.profile_id) byProfile[s.profile_id] = displayName(s);
  }

  return { staff, byProfile, loading, reload };
}
