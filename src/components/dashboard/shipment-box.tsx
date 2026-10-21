"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  SHIPMENT_STATUS_LABELS,
  formatShipmentCode,
  type ShipmentStatus,
} from "@/lib/shipping";

/**
 * Tarjeta de envío extendido (Portal 659 Envíos) en el detalle del pedido:
 * aparece solo si el pedido es delivery con zona extendida
 * (`shipping_zone_id`). Reemplaza al repartidor propio (CourierAssignBox).
 * Estado inicial: aviso a la logística + oblea para imprimir.
 */

type ShipmentRow = {
  id: string;
  code: string;
  status: ShipmentStatus | string;
  shippingZoneName: string | null;
  statusLabel?: string;
};

export function ShipmentBox({
  order,
  onChanged,
}: {
  order: any;
  onChanged?: (order?: any) => void;
}) {
  const eligible = order?.method === "delivery" && !!(order as any)?.shipping_zone_id;

  const [shipment, setShipment] = useState<ShipmentRow | null>(() => {
    const s = (order as any)?.shipment;
    return s && s.id
      ? { id: s.id, code: s.code, status: s.status, shippingZoneName: s.shipping_zone_name ?? null }
      : null;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/shipments");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data?.shipments) ? data.shipments : [];
      const found = list.find((s: any) => String(s.orderId) === String(order.id));
      if (found) {
        setShipment({ id: found.id, code: found.code, status: found.status, shippingZoneName: found.shippingZoneName, statusLabel: found.statusLabel });
      }
    } catch {
      /* noop */
    }
  }, [order.id]);

  useEffect(() => {
    if (!eligible || shipment) return;
    refresh();
  }, [eligible, shipment, refresh]);

  if (!eligible) return null;

  async function createShipment() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        setMsg(data?.error || "No se pudo avisar a la logística");
        return;
      }
      if (data?.shipment) {
        setShipment({
          id: data.shipment.id,
          code: data.shipment.code,
          status: data.shipment.status,
          shippingZoneName: data.shipment.shipping_zone_name ?? null,
          statusLabel: SHIPMENT_STATUS_LABELS[data.shipment.status as ShipmentStatus] || data.shipment.status,
        });
      }
      onChanged?.();
    } catch {
      setMsg("Error de red");
    } finally {
      setBusy(false);
    }
  }

  const statusLabel =
    shipment?.statusLabel ||
    (shipment
      ? SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatus] || String(shipment.status)
      : "");

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-1.5">
      <p className="text-xs font-bold text-violet-900">🚚 Envío extendido (Portal 659)</p>
      <p className="text-[11px] text-violet-800">
        Entrega por logística partner{shipment?.shippingZoneName || (order as any)?.shipping_zone_name ? ` · zona ${(shipment?.shippingZoneName || (order as any)?.shipping_zone_name) as string}` : ""}.
        El comprador la eligió y la pagó en el checkout.
      </p>
      {shipment ? (
        <>
          <p className="text-xs font-semibold text-violet-900">
            {formatShipmentCode(shipment.code)} · {statusLabel}
          </p>
          <div className="flex flex-wrap gap-2 pt-0.5">
            <a href={`/vendor/shipment/${shipment.id}`}>
              <Button size="sm" variant="outline" className="h-7 text-xs">🖨️ Oblea</Button>
            </a>
            <a href={`/envio/${encodeURIComponent(formatShipmentCode(shipment.code))}`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="h-7 text-xs">👀 Ver tracking</Button>
            </a>
          </div>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-violet-300 text-violet-900"
            disabled={busy}
            onClick={createShipment}
          >
            {busy ? "Avisando..." : "🚚 Avisar a la logística"}
          </Button>
          <p className="text-[11px] text-violet-700">
            Avisa a la logística y genera el código de oblea/tracking para el comprador.
          </p>
        </>
      )}
      {msg && <p className="text-[11px] text-amber-700">{msg}</p>}
    </div>
  );
}
