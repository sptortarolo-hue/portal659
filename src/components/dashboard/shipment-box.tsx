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
 *
 * Estado inicial: aviso a la logística (push a sus operadores + WhatsApp
 * pre-armado para coordinar el retiro) y oblea para imprimir — desde que el
 * pedido entra a "Listo para retirar", la oblea es el CTA principal (es el
 * momento en que el paquete se despacha).
 */

type ShipmentRow = {
  id: string;
  code: string;
  status: ShipmentStatus | string;
  shippingZoneName: string | null;
  statusLabel?: string | null;
  podPhotoUrl?: string | null;
  failedReason?: string | null;
  waUrl?: string | null;
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
    // Embebido por el server (attachShipments en /api/vendor/orders y
    // /history): disponible en el primer render, sin fetch de arranque.
    const s = (order as any)?.shipment;
    if (!s || !s.id) return null;
    return {
      id: String(s.id),
      code: String(s.code),
      status: s.status,
      shippingZoneName: s.shippingZoneName ?? s.shipping_zone_name ?? null,
      statusLabel: s.statusLabel ?? null,
      podPhotoUrl: s.podPhotoUrl ?? s.pod_photo_url ?? null,
      failedReason: s.failedReason ?? s.failed_reason ?? null,
      waUrl: s.waUrl ?? s.wa_url ?? null,
    };
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Fallback best-effort: si el pedido vino de una vista sin el envío
  // embebido, lo buscamos por fetch (la ruta lista todos los encargos del
  // comercio).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/shipments");
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data?.shipments) ? data.shipments : [];
      const found = list.find((s: any) => String(s.orderId) === String(order.id));
      if (found) {
        setShipment({
          id: found.id,
          code: found.code,
          status: found.status,
          shippingZoneName: found.shippingZoneName,
          statusLabel: found.statusLabel,
          podPhotoUrl: found.podPhotoUrl ?? null,
          failedReason: found.failedReason ?? null,
          waUrl: found.waUrl ?? null,
        });
      } else if (list.length > 0) {
        setShipment(null);
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
          waUrl: data.waUrl ?? null,
        });
        if (data.pushedOperators) {
          setMsg("Aviso enviado a la logística ✅");
        }
      } else if (res.status === 409) {
        await refresh();
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
  const codeEnv = shipment ? formatShipmentCode(shipment.code) : null;
  const isReady = order?.status === "ready";

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
            {codeEnv} · {statusLabel}
            {shipment.podPhotoUrl ? " 📷" : ""}
          </p>
          {shipment.failedReason && (
            <p className="text-[11px] font-semibold text-red-700">❌ {shipment.failedReason}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            {isReady ? (
              <a href={`/vendor/shipment/${shipment.id}`}>
                <Button size="sm" className="h-7 text-xs">🖨️ Imprimir oblea</Button>
              </a>
            ) : (
              <a href={`/vendor/shipment/${shipment.id}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs">🖨️ Oblea</Button>
              </a>
            )}
            <a href={`/envio/${encodeURIComponent(codeEnv || "")}`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="h-7 text-xs">👀 Ver tracking</Button>
            </a>
            {shipment.waUrl && (
              <a href={shipment.waUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="h-7 text-xs">📲 Avisar WhatsApp</Button>
              </a>
            )}
            {shipment.podPhotoUrl && (
              <a
                href={shipment.podPhotoUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-violet-700 underline-offset-2 hover:underline self-center"
              >
                📷 Ver POD
              </a>
            )}
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
      {msg && <p className="text-[11px] text-violet-700">{msg}</p>}
    </div>
  );
}
