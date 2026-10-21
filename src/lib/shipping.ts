/**
 * Envíos extendidos ("Portal 659 Envíos"): zonas del catálogo del portal
 * fuera del radio barrial, operadas por logísticas partner.
 *
 * Client-safe como `delivery.ts` (sin imports de servidor): lo usan el
 * checkout (espejo visual) y el recálculo server (`order-service`). La regla
 * es simple y deliberada: precio plano del catálogo, SIN gratis-desde
 * (`free_delivery_min` es del reparto barrial propio; el costo de la
 * logística no se regala a menos que el catálogo diga $0).
 */

export type ShippingZoneInfo = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  etaDays: number;
};

export type ResolvedShippingZone = {
  fee: number;
  zoneId: string | null;
  zoneName: string | null;
  etaDays: number | null;
};

export function resolveShippingZoneFee(opts: {
  /** Zonas extendidas activas del comercio (ya resuelto el override). */
  zones?: ShippingZoneInfo[];
  zoneId?: string | null;
}): ResolvedShippingZone {
  const zones = opts.zones || [];
  if (!opts.zoneId) return { fee: 0, zoneId: null, zoneName: null, etaDays: null };
  const z = zones.find((zz) => String(zz.id) === String(opts.zoneId));
  if (!z) {
    // Zona inexistente/desactivada (request directo u opt-in apagado hace
    // un momento): el pedido NO se rechaza, cae fuera de zona y sigue el
    // flujo histórico (coordina por WhatsApp). Igual que delivery.ts.
    return { fee: 0, zoneId: null, zoneName: null, etaDays: null };
  }
  return {
    fee: Math.round(z.price * 100) / 100,
    zoneId: String(z.id),
    zoneName: z.name,
    etaDays: z.etaDays > 0 ? z.etaDays : null,
  };
}

/** Etiqueta corta para detalle/ticket/WhatsApp. */
export function shippingZoneLabel(
  fee: number,
  etaDays: number | null,
  zoneName: string | null
): string {
  const eta = etaDays && etaDays > 0 ? ` · llega en ${etaDays} ${etaDays === 1 ? "día" : "días"}` : "";
  return `${zoneName || "Zona extendida"}: $${Number(fee || 0).toLocaleString("es-AR")}${eta}`;
}

/** Estados del envío (vocabulario propio de la logística). */
export type ShipmentStatus =
  | "requested"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "failed_attempt"
  | "returned"
  | "cancelled";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  requested: "Avisado a la logística",
  picked_up: "Colectado",
  in_transit: "En camino",
  delivered: "Entregado",
  failed_attempt: "No entregado",
  returned: "Devuelto al comercio",
  cancelled: "Cancelado",
};

export const SHIPMENT_FLOW_STEPS: ShipmentStatus[] = [
  "requested",
  "picked_up",
  "in_transit",
  "delivered",
];

/** Código público para la oblea/tracking, legible: ENV-XXXXXX. */
export function formatShipmentCode(code: string): string {
  return code.startsWith("ENV-") ? code.toUpperCase() : `ENV-${code.toUpperCase()}`;
}

/**
 * Cómo impacta el evento del carrier en el pedido: solo picked_up/in_transit
 * → 'sent' y delivered → 'completed'. returned → cancel por motivo. El
 * resto NO toca los estados del pedido (failed_attempt mantiene 'sent',
 * quizás venga un segundo intento).
 */
export function orderStatusForShipmentEvent(
  status: string
): "sent" | "completed" | "cancelled" | null {
  if (status === "picked_up" || status === "in_transit") return "sent";
  if (status === "delivered") return "completed";
  if (status === "returned") return "cancelled";
  return null;
}
