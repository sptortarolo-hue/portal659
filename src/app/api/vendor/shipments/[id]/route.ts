import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { formatShipmentCode } from "@/lib/shipping";

export const dynamic = "force-dynamic";

/**
 * Detalle del envío del comercio.
 * GET: shipment + timeline de eventos.
 * DELETE: cancela el encargo (solo si aún no fue colectado: estado 'requested'
 * o 'failed_attempt' — después de colectado hay que hablar con la logística).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  const { id } = await context.params;

  let shipment: Record<string, unknown> | undefined;
  let events: Array<Record<string, unknown>> = [];
  try {
    shipment = await queryOne<Record<string, unknown>>(
      `SELECT s.id, s.order_id, s.code, s.status, s.note, s.failed_reason, s.pod_photo_url,
              s.shipping_zone_name, s.requested_at, s.picked_up_at, s.delivered_at, s.created_at,
              s.delivered_to_name, s.delivered_dni, s.delivered_lat, s.delivered_lng, s.delivered_geo_ok,
              o.pickup_number AS order_number, o.total, o.customer_name, o.customer_phone,
              o.customer_address, o.items, o.status AS order_status
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1 AND s.vendor_id = $2
       LIMIT 1`,
      [id, vendor.id]
    );
    if (shipment) {
      events = await queryMany<Record<string, unknown>>(
        `SELECT status, note, photo_url, created_at
         FROM shipment_events WHERE shipment_id = $1
         ORDER BY created_at ASC`,
        [id]
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración de envíos (migrate-portal-shipments.sql)" },
      { status: 503 }
    );
  }

  if (!shipment) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
  // Código con formato de oblea (ENV-XXXXXX) para mostrar y armar el link/QR.
  shipment.code = formatShipmentCode(String(shipment.code));
  return NextResponse.json({ shipment, events: events || [] });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { vendor, staffRole } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (staffRole === "delivery") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await context.params;

  try {
    const row = await queryOne<{ status: string }>(
      `SELECT status FROM shipments WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [id, vendor.id]
    );
    if (!row) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
    const cancellable = row.status === "requested" || row.status === "failed_attempt";
    if (!cancellable) {
      return NextResponse.json(
        { error: "El paquete ya está en la logística: coordiná la devolución con el operador" },
        { status: 409 }
      );
    }

    await queryOne(
      `UPDATE shipments SET status = 'cancelled'
       WHERE id = $1 AND status IN ('requested', 'failed_attempt')
       RETURNING id`,
      [id]
    );
    await queryOne(
      `INSERT INTO shipment_events (shipment_id, status, note, operator_profile_id)
       VALUES ($1, 'cancelled', 'Cancelado por el comercio', NULL)`,
      [id]
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "No se pudo cancelar el envío" }, { status: 500 });
  }
}
