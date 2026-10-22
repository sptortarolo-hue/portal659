/**
 * Zonas extendidas del comercio (Portal 659 Envíos) desde la DB.
 *
 * Solo servidor (importa pg). Tolerante a la migración sin aplicar: si falta
 * la tabla/columnas devuelve [] y todo sigue como hoy (sin zonas extendidas,
 * el checkout no las muestra y los pedidos no cambian).
 */
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import type { ShippingZoneInfo } from "@/lib/shipping";
import { orderStatusForShipmentEvent, SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/shipping";

export type VendorShipZoneFull = ShippingZoneInfo & {
  carrierId: string | null;
  carrierName: string | null;
};

export async function fetchVendorShipZones(vendorId: string): Promise<VendorShipZoneFull[]> {
  try {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT sz.id, sz.name, sz.description, sz.eta_days, sz.carrier_id, c.name AS carrier_name,
              COALESCE(vsz.fee_override, sz.price) AS price
       FROM vendor_ship_zones vsz
       JOIN shipping_zones sz ON sz.id = vsz.shipping_zone_id
       LEFT JOIN carriers c ON c.id = sz.carrier_id
       WHERE vsz.vendor_id = $1 AND vsz.active = true AND sz.active = true
       ORDER BY sz.position ASC, sz.created_at ASC`,
      [vendorId]
    );
    return (rows || []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      description: r.description != null ? String(r.description) : null,
      price: Number(r.price) || 0,
      etaDays: Number(r.eta_days) || 0,
      carrierId: r.carrier_id != null ? String(r.carrier_id) : null,
      carrierName: r.carrier_name != null ? String(r.carrier_name) : null,
    }));
  } catch {
    // Migración sin aplicar u otro error: sin zonas extendidas.
    return [];
  }
}

/**
 * Impacta el evento del carrier en el pedido (mapping shipped):
 * picked_up/in_transit → 'sent'; delivered → 'completed'; returned →
 * 'cancelled'. Tolerante: si el pedido ya está en el destino no repite log;
 * si algo falla NO rompe el guardado del evento (best-effort aislado).
 */
export async function syncOrderForShipmentStatus(
  orderId: string,
  status: string
): Promise<{ applied: boolean; orderStatus?: string }> {
  const target = orderStatusForShipmentEvent(status);
  if (!target) return { applied: false };

  try {
    return await withTransaction(async (tx) => {
      const order = await tx.queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      if (!order) return { applied: false };
      if (order.status === "cancelled" || order.status === "completed") {
        return { applied: false };
      }
      if (order.status === target) return { applied: false, orderStatus: target };

      await tx.queryVoid(
        `UPDATE orders SET status = $2,
           closed_at = $3
         WHERE id = $1`,
        [
          orderId,
          target,
          target === "completed" || target === "cancelled" ? new Date().toISOString() : null,
        ]
      );
      await tx.queryVoid(
        `INSERT INTO order_status_log (order_id, status)
         VALUES ($1, $2)`,
        [orderId, target]
      );
    return { applied: true, orderStatus: target };
  });
  } catch {
    return { applied: false };
  }
}

/** Carrier(s) de un operador (via carrier_operators). [] si no hay. */
export async function fetchOperatorCarriers(profileId: string): Promise<
  { id: string; name: string; displayName: string | null }[]
> {
  try {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT c.id, c.name, o.display_name
       FROM carrier_operators o
       JOIN carriers c ON c.id = o.carrier_id
       WHERE o.profile_id = $1 AND o.active = true AND c.active = true
       ORDER BY c.name ASC`,
      [profileId]
    );
    return (rows || []).map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      displayName: r.display_name != null ? String(r.display_name) : null,
    }));
  } catch {
    return [];
  }
}

/** Timeline sin migration-safe: la tabla existe tras la migración. */
export async function fetchShipmentEvents(shipmentId: string) {
  try {
    return (
      (await queryMany<Record<string, unknown>>(
        `SELECT status, note, photo_url, operator_profile_id, created_at
         FROM shipment_events WHERE shipment_id = $1
         ORDER BY created_at ASC`,
        [shipmentId]
      )) || []
    );
  } catch {
    return [];
  }
}

/**
 * Probes cacheados de columnas extendidas (migraciones pod/carrier-wa sin
 * aplicar → las queries usan la variante corta en vez de romper). TTL 60s:
 * si el admin aplica la migración con el server corriendo, en un minuto se
 * re-probea y el modo completo se activa solo (sin restart).
 */
const PROBE_TTL_MS = 60_000;

let extColsOk: boolean | null = null;
let extColsAt = 0;
export async function shipmentExtColsReady(): Promise<boolean> {
  if (extColsOk !== null && Date.now() - extColsAt < PROBE_TTL_MS) return extColsOk;
  try {
    await queryOne(`SELECT dest_lat FROM shipments LIMIT 1`);
    extColsOk = true;
  } catch {
    extColsOk = false;
  }
  extColsAt = Date.now();
  return extColsOk;
}

let ackColsOk: boolean | null = null;
let ackColsAt = 0;
export async function shipmentAckColsReady(): Promise<boolean> {
  if (ackColsOk !== null && Date.now() - ackColsAt < PROBE_TTL_MS) return ackColsOk;
  try {
    await queryOne(`SELECT ack_at FROM shipments LIMIT 1`);
    ackColsOk = true;
  } catch {
    ackColsOk = false;
  }
  ackColsAt = Date.now();
  return ackColsOk;
}

/** Columnas WA del carrier (migrate-carrier-wa.sql). */
let carrierWaColsOk: boolean | null = null;
let carrierWaColsAt = 0;
export async function carrierWaColsReady(): Promise<boolean> {
  if (carrierWaColsOk !== null && Date.now() - carrierWaColsAt < PROBE_TTL_MS) return carrierWaColsOk;
  try {
    await queryOne(`SELECT wa_phones FROM carriers LIMIT 1`);
    carrierWaColsOk = true;
  } catch {
    carrierWaColsOk = false;
  }
  carrierWaColsAt = Date.now();
  return carrierWaColsOk;
}

/**
 * Envíos embebidos por pedido (row mutada in-place): el panel del comercio
 * abre el detalle con `order.shipment` disponible en el primer render
 * (antes dependía de un segundo fetch a /api/vendor/shipments y el bloque
 * violeta "parpadeaba"/desaparecía entre polls). 200 pedidos máx = lista del
 * tablero; tolerante a migración sin aplicar (variante corta sin dest/cert).
 */
export async function attachShipments(
  // Cualquier fila del panel (el spread del caller destruye el tipo exacto);
  // mutamos in-place con campos camelCase.
  orders: Array<any>,
  vendorId: string
): Promise<void> {
  if (!Array.isArray(orders) || orders.length === 0) return;
  const orderIds = orders.map((o) => o.id).slice(0, 400);
  const extCols = await shipmentExtColsReady();
  const ackCols = extCols && (await shipmentAckColsReady());
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows =
      (await queryMany<Record<string, unknown>>(
        `SELECT DISTINCT ON (order_id)
                s.order_id, s.id, s.code, s.status, s.note, s.failed_reason, s.pod_photo_url,
                s.shipping_zone_name${extCols ? `,
                s.dest_lat, s.dest_lng,
                s.delivered_to_name, s.delivered_dni, s.delivered_lat, s.delivered_lng, s.delivered_geo_ok` : ""}${ackCols ? `,
                s.ack_at` : ""}
         FROM shipments s
         WHERE s.vendor_id = $1 AND s.order_id = ANY($2::uuid[])
         ORDER BY s.order_id, s.created_at DESC`,
        [vendorId, orderIds]
      )) || [];
  } catch {
    return; // Migración sin aplicar: los pedidos quedan sin `shipment` (como hoy).
  }
  const byOrder = new Map<string, Record<string, unknown>>();
  for (const r of rows) byOrder.set(String(r.order_id), r);
  for (const o of orders) {
    const r = byOrder.get(String(o.id));
    if (!r) continue;
    const status = String(r.status);
    o.shipment = {
      id: String(r.id),
      code: formatCode(String(r.code)),
      status,
      statusLabel: SHIPMENT_STATUS_LABELS[status as ShipmentStatus] || status,
      shippingZoneName: r.shipping_zone_name != null ? String(r.shipping_zone_name) : null,
      podPhotoUrl: r.pod_photo_url != null ? String(r.pod_photo_url) : null,
      failedReason: r.failed_reason != null ? String(r.failed_reason) : null,
      // Certificado de entrega (visible cuando delivered; solo con migración).
      deliveredToName: r.delivered_to_name != null ? String(r.delivered_to_name) : null,
      deliveredDni: r.delivered_dni != null ? String(r.delivered_dni) : null,
      deliveredLat: r.delivered_lat != null ? Number(r.delivered_lat) : null,
      deliveredLng: r.delivered_lng != null ? Number(r.delivered_lng) : null,
      deliveredGeoOk: r.delivered_geo_ok === true,
      // Acuse de recibo de la logística (lo ve el comercio en el bloque).
      ackAt: r.ack_at != null ? String(r.ack_at) : null,
    };
  }
}

/** ENV-XXXXXX para el comprador (misma regla client-safe del lib shipping). */
function formatCode(code: string): string {
  const s = (code || "").toUpperCase();
  return s.startsWith("ENV-") ? s : `ENV-${s}`;
}

/** Encargo con pedido asociado (para panel operador y tracking). */
export async function fetchShipmentWithOrder(opts: {  shipmentId?: string;
  code?: string;
  carrierId?: string | null;
}): Promise<Record<string, unknown> | undefined> {
  try {
    return await queryOne<Record<string, unknown>>(
      `SELECT s.id, s.order_id, s.vendor_id, s.carrier_id, s.code, s.status, s.note, s.failed_reason,
              s.shipping_zone_name, s.requested_at, s.picked_up_at, s.delivered_at, s.created_at,
              o.pickup_number AS order_number, o.total, o.customer_name, o.customer_phone, o.customer_address,
              o.method, o.status AS order_status,
              v.store_name, v.slug AS store_slug, v.location AS store_address
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       JOIN vendors v ON v.id = s.vendor_id
       WHERE ${opts.shipmentId ? "s.id = $1" : "UPPER(s.code) = $1"}
         ${opts.carrierId ? "AND s.carrier_id = $2" : ""}
       LIMIT 1`,
      opts.carrierId
        ? opts.shipmentId
          ? [opts.shipmentId, opts.carrierId]
          : [opts.code || "", opts.carrierId]
        : [opts.shipmentId || opts.code || ""]
    );
  } catch {
    return undefined;
  }
}
