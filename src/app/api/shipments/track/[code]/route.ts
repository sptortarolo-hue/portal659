import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { formatShipmentCode, SHIPMENT_STATUS_LABELS } from "@/lib/shipping";

export const dynamic = "force-dynamic";

/**
 * Tracking público del envío por código de oblea (ENV-XXXXXX).
 * Solo timeline + comercio destino: nunca datos del comprador (privacidad:
 * el código viaja impreso en el paquete, cualquiera que lo vea escanea).
 */
export const GET = withRateLimit(
  async (_request: Request, context: { params: Promise<{ code: string }> }) => {
    const { code } = await context.params;
    const clean = formatShipmentCode(String(code || "").trim());

    let shipment: Record<string, unknown> | undefined;
    let events: Array<Record<string, unknown>> = [];
    try {
      shipment = await queryOne<Record<string, unknown>>(
        `SELECT s.code, s.status, s.shipping_zone_name, s.requested_at, s.picked_up_at,
                s.delivered_at, s.created_at,
                v.store_name, v.slug, v.address AS store_address
         FROM shipments s
         JOIN vendors v ON v.id = s.vendor_id
         WHERE UPPER(s.code) = $1
         ORDER BY s.created_at DESC
         LIMIT 1`,
        [clean]
      );
      if (shipment) {
        events = await queryMany<Record<string, unknown>>(
          `SELECT status, note, photo_url, created_at
           FROM shipment_events WHERE shipment_id = (
             SELECT id FROM shipments WHERE UPPER(code) = $1
             ORDER BY created_at DESC LIMIT 1
           )
           ORDER BY created_at ASC`,
          [clean]
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

    return NextResponse.json({
      shipment: {
        code: formatShipmentCode(String(shipment.code)),
        status: String(shipment.status),
        statusLabel:
          SHIPMENT_STATUS_LABELS[String(shipment.status) as keyof typeof SHIPMENT_STATUS_LABELS] ||
          String(shipment.status),
        zoneName: shipment.shipping_zone_name != null ? String(shipment.shipping_zone_name) : null,
        requestedAt: shipment.requested_at,
        pickedUpAt: shipment.picked_up_at,
        deliveredAt: shipment.delivered_at,
        createdAt: shipment.created_at,
        storeName: shipment.store_name != null ? String(shipment.store_name) : null,
        storeSlug: shipment.slug != null ? String(shipment.slug) : null,
        storeAddress: shipment.store_address != null ? String(shipment.store_address) : null,
      },
      timeline,
    });
  },
  { maxRequests: 60 }
);
