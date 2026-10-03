"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DeliveryLiveMap } from "@/components/orders/delivery-live-map";
import { useDeliveryStaff } from "@/components/vendor/use-delivery-staff";
import type { Order } from "@/types/database";

/**
 * Repartidor del pedido (panel del dueño, solo delivery).
 * - Sin asignar + ready/sent: selector de repartidores vinculados + Asignar.
 * - Asignado: nombre + Soltar (libera al pool aunque lo haya tomado otro).
 * - En `sent` con señal: mapa vivo (poll 15s al pedido).
 * - Entregado/cancelado: quién lo llevó (auditoría simple).
 * El repartidor sigue pudiendo auto-tomar (claim) lo no asignado: lo que
 * suceda primero gana (el server resuelve la carrera con 409).
 */
export function CourierAssignBox({
  order,
  vendorName,
  onAssigned,
}: {
  order: Order;
  vendorName: string;
  onAssigned?: (order: Order) => void;
}) {
  const assignable = order.method === "delivery" && (order.status === "ready" || order.status === "sent");
  const showBox = order.method === "delivery";
  const { staff, byProfile } = useDeliveryStaff(showBox);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [live, setLive] = useState<{
    assigned_to: string | null;
    courier_lat: number | null;
    courier_lng: number | null;
    courier_updated_at: string | null;
    status: string;
  } | null>(null);

  const assignedTo = live?.assigned_to ?? (order as any).assigned_to ?? null;
  const assignedName = assignedTo ? byProfile[String(assignedTo)] || null : null;

  // Posición viva del repartidor (solo en `sent`: el POST position del
  // repartidor exige ese estado y el PATCH la nulifica al entregar).
  const trackLive = order.method === "delivery" && order.status === "sent";
  useEffect(() => {
    if (!trackLive) {
      setLive(null);
      return;
    }
    let alive = true;
    async function poll() {
      try {
        const res = await fetch(`/api/vendor/orders/${order.id}`);
        const data = await res.json().catch(() => ({}));
        if (!alive || !data?.order) return;
        const o = data.order;
        setLive({
          assigned_to: o.assigned_to ?? null,
          courier_lat: o.courier_lat != null ? Number(o.courier_lat) : null,
          courier_lng: o.courier_lng != null ? Number(o.courier_lng) : null,
          courier_updated_at: o.courier_updated_at ?? null,
          status: o.status,
        });
      } catch {
        /* sin señal del panel: el mapa muestra la última conocida */
      }
    }
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [trackLive, order.id]);

  if (!showBox) return null;

  async function refreshOrder() {
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}`);
      const data = await res.json().catch(() => ({}));
      if (data?.order) {
        const o = data.order;
        setLive({
          assigned_to: o.assigned_to ?? null,
          courier_lat: o.courier_lat != null ? Number(o.courier_lat) : null,
          courier_lng: o.courier_lng != null ? Number(o.courier_lng) : null,
          courier_updated_at: o.courier_updated_at ?? null,
          status: o.status,
        });
        onAssigned?.(o as Order);
      }
    } catch {
      /* noop */
    }
  }

  async function run(action: "assign" | "unassign") {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/vendor/orders/${order.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "assign" ? { action, staffId: selected } : { action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || "No se pudo asignar");
      setSelected("");
      await refreshOrder();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo asignar");
    } finally {
      setBusy(false);
    }
  }

  const activeStaff = staff.filter((s) => s.status === "active" && s.profile_id);
  const courierLat = live?.courier_lat ?? (order as any).courier_lat ?? null;
  const courierLng = live?.courier_lng ?? (order as any).courier_lng ?? null;
  const courierUpdatedAt = live?.courier_updated_at ?? (order as any).courier_updated_at ?? null;
  const showMap =
    order.method === "delivery" &&
    (live?.status ?? order.status) === "sent" &&
    courierLat != null &&
    courierLng != null;
  const noSignal =
    order.method === "delivery" &&
    (live?.status ?? order.status) === "sent" &&
    (courierLat == null || courierLng == null);

  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <Label>🛵 Repartidor</Label>
      {assignedTo ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold truncate" title={assignedName || undefined}>
            🛵 {assignedName || "Asignado"}
          </p>
          {assignable && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run("unassign")}>
              {busy ? "…" : "Soltar"}
            </Button>
          )}
        </div>
      ) : assignable ? (
        <div className="space-y-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full h-10 px-2 text-sm rounded-xl border border-input bg-background"
            aria-label="Repartidor"
          >
            <option value="">Elegí repartidor…</option>
            {staff
              .filter((s) => s.status !== "revoked")
              .map((s) => (
                <option key={s.id} value={s.id} disabled={!s.profile_id || s.status !== "active"}>
                  {(s.full_name || s.phone || "Repartidor") + (s.status === "active" && s.profile_id ? "" : " — aún no se vinculó")}
                </option>
              ))}
          </select>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={busy || !selected || activeStaff.every((s) => s.id !== selected)}
            onClick={() => run("assign")}
          >
            {busy ? "Asignando…" : "Asignar pedido"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            O esperá a que lo tome un repartidor desde su tablero.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {order.status === "completed" || order.status === "cancelled"
            ? "Sin repartidor asignado."
            : "Se asigna cuando esté listo para entregar."}
        </p>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      {showMap && (
        <DeliveryLiveMap
          title="🛵 Reparto en curso"
          storeName={vendorName}
          vendorLat={null}
          vendorLng={null}
          courierLat={Number(courierLat)}
          courierLng={Number(courierLng)}
          courierUpdatedAt={courierUpdatedAt}
        />
      )}
      {noSignal && (
        <p className="text-[11px] text-muted-foreground">
          🛰️ El repartidor aún no comparte su ubicación en vivo — aparece acá en cuanto la active.
        </p>
      )}
    </div>
  );
}
