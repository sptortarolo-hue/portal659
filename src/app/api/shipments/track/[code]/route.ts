import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { formatShipmentCode, SHIPMENT_STATUS_LABELS } from "@/lib/shipping";

export const dynamic = "force-dynamic";

/**
 * Tracking público del envío por código de oblea (ENV-XXXXXX).
 * Timeline + comercio destino. Datos del destinatario (nombre/dirección/
 * teléfono) solo con el paquete en reparto: quien los ve ya tiene el paquete
 * físico en la mano (la oblea lleva la misma info impresa) y esos son los
 * datos que la hoja del repartidor usa para entregar. Nunca el DNI del
 * certificado ni datos fuera de esos estados.
 */
export const GET = withRateLimit(
  async (_request: Request, context: { params: Promise<{ code: string }> }) => {
    const { code } = await context.params;
    const clean = formatShipmentCode(String(code || "").trim());
    // En DB el código vive SIN el prefijo "ENV-" (se formatea para la oblea).
    // Aceptamos ambos formatos en la query para no romper links viejos/QRs.
    const raw = clean.replace(/^ENV-/i, "");

    let shipment: Record<string, unknown> | undefined;
    let events: Array<Record<string, unknown>> = [];
    try {
      shipment = await queryOne<Record<string, unknown>>(
        `SELECT s.code, s.status, s.shipping_zone_name, s.requested_at, s.picked_up_at,
                s.delivered_at, s.created_at,
                o.customer_name, o.customer_phone, o.customer_address,
                v.store_name, v.slug, v.location AS store_address
         FROM shipments s
         JOIN vendors v ON v.id = s.vendor_id
         JOIN orders o ON o.id = s.order_id
         WHERE UPPER(s.code) = $1
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [raw]
      );
      if (shipment) {
        events = await queryMany<Record<string, unknown>>(
          `SELECT status, note, photo_url, created_at
           FROM shipment_events WHERE shipment_id = (
             SELECT id FROM shipments WHERE UPPER(code) = $1
             ORDER BY created_at DESC LIMIT 1
           )
           ORDER BY created_at ASC`,
          [raw]
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Seguimiento de envíos no disponible por el momento" },
        { status: 503 }
      );
    }

    if (!shipment) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });

    const timeline = (events || []).map((e) => ({
      status: String(e.status),
      label: SHIPMENT_STATUS_LABELS[String(e.status) as keyof typeof SHIPMENT_STATUS_LABELS] || String(e.status),
      note: e.note != null ? String(e.note) : null,
      photoUrl: e.photo_url != null ? String(e.photo_url) : null,
      createdAt: e.created_at,
    }));

    const statusKey = String(shipment.status);
    // Datos para la hoja del repartidor: solo con el paquete en reparto.
    const courierActionable =
      statusKey === "picked_up" || statusKey === "in_transit" || statusKey === "failed_attempt";

    return NextResponse.json({
      shipment: {
        code: formatShipmentCode(String(shipment.code)),
        status: statusKey,
        statusLabel:
          SHIPMENT_STATUS_LABELS[statusKey as keyof typeof SHIPMENT_STATUS_LABELS] ||
          statusKey,
        zoneName: shipment.shipping_zone_name != null ? String(shipment.shipping_zone_name) : null,
        requestedAt: shipment.requested_at,
        pickedUpAt: shipment.picked_up_at,
        deliveredAt: shipment.delivered_at,
        createdAt: shipment.created_at,
        storeName: shipment.store_name != null ? String(shipment.store_name) : null,
        storeSlug: shipment.slug != null ? String(shipment.slug) : null,
        storeAddress: shipment.store_address != null ? String(shipment.store_address) : null,
        customerName: courierActionable && shipment.customer_name != null ? String(shipment.customer_name) : null,
        customerPhone: courierActionable && shipment.customer_phone != null ? String(shipment.customer_phone) : null,
        customerAddress: courierActionable && shipment.customer_address != null ? String(shipment.customer_address) : null,
      },
      timeline,
    });
  },
  { maxRequests: 60 }
);
