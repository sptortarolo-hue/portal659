/**
 * Zonas extendidas del comercio (Portal 659 Envíos) desde la DB.
 *
 * Solo servidor (importa pg). Tolerante a la migración sin aplicar: si falta
 * la tabla/columnas devuelve [] y todo sigue como hoy (sin zonas extendidas,
 * el checkout no las muestra y los pedidos no cambian).
 */
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import type { ShippingZoneInfo } from "@/lib/shipping";
import { orderStatusForShipmentEvent } from "@/lib/shipping";

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

/** Encargo con pedido asociado (para panel operador y tracking). */
export async function fetchShipmentWithOrder(opts: {
  shipmentId?: string;
  code?: string;
  carrierId?: string | null;
}): Promise<Record<string, unknown> | undefined> {
  try {
    return await queryOne<Record<string, unknown>>(
      `SELECT s.id, s.order_id, s.vendor_id, s.carrier_id, s.code, s.status, s.note, s.failed_reason,
              s.shipping_zone_name, s.requested_at, s.picked_up_at, s.delivered_at, s.created_at,
              o.order_number, o.total, o.customer_name, o.customer_phone, o.customer_address,
              o.method, o.status AS order_status,
              v.store_name, v.slug AS store_slug, v.address AS store_address
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
