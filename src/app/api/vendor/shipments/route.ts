import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";
import { formatShipmentCode, SHIPMENT_STATUS_LABELS } from "@/lib/shipping";
import { buildCarrierWaUrl, carrierWaText, notifyCarrierOperators } from "@/lib/shipping-notify";

export const dynamic = "force-dynamic";

/**
 * Envíos extendidos por comercio (Portal 659 Envíos).
 * GET lista los envíos del comercio (con datos del pedido asociado).
 * POST {orderId} crea el encargo a la logística (estado 'requested' + código
 * público para la oblea). 1 pedido = 1 envío (UNIQUE order_id): re-invocar
 * devuelve el existente en vez de duplicar.
 */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  try {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT s.id, s.order_id, s.code, s.status, s.note, s.failed_reason, s.pod_photo_url,
              s.shipping_zone_name, s.requested_at, s.picked_up_at, s.delivered_at, s.created_at,
              s.dest_lat, s.dest_lng,
              s.delivered_to_name, s.delivered_dni, s.delivered_lat, s.delivered_lng, s.delivered_geo_ok,
              o.pickup_number AS order_number, o.total, o.customer_name, o.customer_phone,
              o.customer_address, o.method, o.status AS order_status, o.delivery_window,
              v.store_name, v.location AS store_address,
              c.phone AS carrier_phone
       FROM shipments s
       JOIN orders o ON o.id = s.order_id
       JOIN vendors v ON v.id = s.vendor_id
       LEFT JOIN carriers c ON c.id = s.carrier_id
       WHERE s.vendor_id = $1
       ORDER BY s.created_at DESC
       LIMIT 200`,
      [vendor.id]
    );
    const shipments = (rows || []).map((r) => {
      const codePub = formatShipmentCode(String(r.code));
      const statusKey = String(r.status);
      const waText = carrierWaText({
        code: codePub,
        storeName: r.store_name != null ? String(r.store_name) : null,
        storeAddress: r.store_address != null ? String(r.store_address) : null,
        zoneName: r.shipping_zone_name != null ? String(r.shipping_zone_name) : null,
        etaDays: null,
        customerName: r.customer_name != null ? String(r.customer_name) : null,
        customerPhone: r.customer_phone != null ? String(r.customer_phone) : null,
        customerAddress: r.customer_address != null ? String(r.customer_address) : null,
        orderNumber: r.order_number != null ? String(r.order_number) : null,
      });
      return {
        id: String(r.id),
        orderId: String(r.order_id),
        orderNumber: r.order_number != null ? String(r.order_number) : null,
        code: codePub,
        status: statusKey,
        statusLabel: SHIPMENT_STATUS_LABELS[statusKey as keyof typeof SHIPMENT_STATUS_LABELS] || statusKey,
        note: r.note != null ? String(r.note) : null,
        failedReason: r.failed_reason != null ? String(r.failed_reason) : null,
        podPhotoUrl: r.pod_photo_url != null ? String(r.pod_photo_url) : null,
        destLat: r.dest_lat != null ? Number(r.dest_lat) : null,
        destLng: r.dest_lng != null ? Number(r.dest_lng) : null,
        shippingZoneName: r.shipping_zone_name != null ? String(r.shipping_zone_name) : null,
        requestedAt: r.requested_at,
        deliveredAt: r.delivered_at,
        createdAt: r.created_at,
        // Certificado de entrega (quién + DNI + GPS al entregar).
        deliveredToName: r.delivered_to_name != null ? String(r.delivered_to_name) : null,
        deliveredDni: r.delivered_dni != null ? String(r.delivered_dni) : null,
        deliveredLat: r.delivered_lat != null ? Number(r.delivered_lat) : null,
        deliveredLng: r.delivered_lng != null ? Number(r.delivered_lng) : null,
        deliveredGeoOk: r.delivered_geo_ok === true,
        waUrl:
          r.carrier_phone != null ? buildCarrierWaUrl(String(r.carrier_phone), waText) : null,
        order: {
          total: Number(r.total) || 0,
          customerName: r.customer_name != null ? String(r.customer_name) : null,
          customerPhone: r.customer_phone != null ? String(r.customer_phone) : null,
          customerAddress: r.customer_address != null ? String(r.customer_address) : null,
          method: r.method != null ? String(r.method) : null,
          status: r.order_status != null ? String(r.order_status) : null,
          deliveryWindow: r.delivery_window != null ? String(r.delivery_window) : null,
        },
      };
    });
    return NextResponse.json({ shipments });
  } catch {
    // Migración sin aplicar (tabla shipments no existe).
    return NextResponse.json({ shipments: [] });
  }
}

export async function POST(request: Request) {
  const { vendor, staffRole } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (staffRole === "delivery") return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const orderId = String(body?.orderId ?? "").trim();
  if (!orderId) return NextResponse.json({ error: "Falta el pedido" }, { status: 400 });
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;

  try {
    const existing = await queryOne<{ id: string; code: string; status: string }>(
      `SELECT id, code, status FROM shipments WHERE order_id = $1 LIMIT 1`,
      [orderId]
    );
    if (existing) {
      return NextResponse.json({
        ok: true,
        shipment: { ...existing, code: formatShipmentCode(existing.code) },
        alreadyExisted: true,
      });
    }
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración de envíos (migrate-portal-shipments.sql)" },
      { status: 503 }
    );
  }

  // El pedido debe ser delivery con zona extendida de este comercio y no estar
  // cancelado.
  const order = await queryOne<Record<string, unknown>>(
    `SELECT id, shipping_zone_id, shipping_zone_name, status, method
     FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (String(order.status) === "cancelled") {
    return NextResponse.json({ error: "El pedido está cancelado" }, { status: 400 });
  }
  if (!order.shipping_zone_id) {
    return NextResponse.json(
      { error: "El pedido no es de una zona extendida (fuera del radio propio va coordinado por WhatsApp)" },
      { status: 400 }
    );
  }

  // Código público legible y único: ENV-Xxxxxx (alfabeto sin ambigüedades).
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }

  try {
    const shipment = await withTransaction(async (tx) => {
      // Carrier pre-asignado desde la zona del catálogo (manual operable).
      const zone = await tx.queryOne<{ carrier_id: string | null }>(
        `SELECT carrier_id FROM shipping_zones WHERE id = $1 LIMIT 1`,
        [order.shipping_zone_id as string]
      ).catch(() => undefined);
      const row = await tx.queryOne<{ id: string; code: string; status: string }>(
        `INSERT INTO shipments (order_id, vendor_id, carrier_id, shipping_zone_id, shipping_zone_name, code, status, note)
         VALUES ($1, $2, $3, $4, $5, $6, 'requested', $7)
         RETURNING id, code, status`,
        [
          orderId,
          vendor.id,
          zone?.carrier_id != null ? String(zone.carrier_id) : null,
          order.shipping_zone_id as string,
          order.shipping_zone_name != null ? String(order.shipping_zone_name) : null,
          code,
          note,
        ]
      );
      if (!row) throw new Error("No se pudo crear el envío");
      await tx.queryVoid(
        `INSERT INTO shipment_events (shipment_id, status, note, operator_profile_id)
         VALUES ($1, 'requested', $2, NULL)`,
        [row.id, note ? `Encargo del comercio: ${note}` : "Encargo recibido del comercio"]
      );
      return row;
    });

    // Datos para el WhatsApp al carrier + push a sus operadores (fuera de la
    // tx, best-effort: si falla el aviso el encargo ya está creado).
    const waInfo = await queryOne<Record<string, unknown>>(
      `SELECT o.pickup_number AS order_number, o.customer_name, o.customer_phone,
              o.customer_address, sz.eta_days,
              v.store_name, v.location AS store_address,
              c.phone AS carrier_phone, c.id AS carrier_id
       FROM orders o
       JOIN vendors v ON v.id = o.vendor_id
       JOIN shipping_zones sz ON sz.id = $2
       LEFT JOIN carriers c ON c.id = sz.carrier_id
       WHERE o.id = $1
       LIMIT 1`,
      [orderId, order.shipping_zone_id as string]
    ).catch(() => undefined);

    const zoneName = order.shipping_zone_name != null ? String(order.shipping_zone_name) : null;
    const codePub = formatShipmentCode(shipment.code);
    const waText = waInfo
      ? carrierWaText({
          code: codePub,
          storeName: waInfo.store_name != null ? String(waInfo.store_name) : null,
          storeAddress: waInfo.store_address != null ? String(waInfo.store_address) : null,
          zoneName,
          etaDays: waInfo.eta_days != null ? Number(waInfo.eta_days) : null,
          customerName: waInfo.customer_name != null ? String(waInfo.customer_name) : null,
          customerPhone: waInfo.customer_phone != null ? String(waInfo.customer_phone) : null,
          customerAddress: waInfo.customer_address != null ? String(waInfo.customer_address) : null,
          orderNumber: waInfo.order_number != null ? String(waInfo.order_number) : null,
        })
      : "";
    const waUrl =
      waInfo && waInfo.carrier_phone != null ? buildCarrierWaUrl(String(waInfo.carrier_phone), waText) : null;
    const pushedOperators = await notifyCarrierOperators(
      waInfo?.carrier_id != null ? String(waInfo.carrier_id) : null,
      { code: codePub, zoneName, storeName: waInfo?.store_name != null ? String(waInfo.store_name) : null }
    ).catch(() => 0);

    return NextResponse.json({
      ok: true,
      shipment: { ...shipment, code: codePub },
      waUrl,
      carrierPhone: waInfo?.carrier_phone != null ? String(waInfo.carrier_phone) : null,
      pushedOperators,
      statusLabel: SHIPMENT_STATUS_LABELS[shipment.status as keyof typeof SHIPMENT_STATUS_LABELS] || "requested",
    });
  } catch {
    return NextResponse.json({ error: "No se pudo crear el envío" }, { status: 500 });
  }
}
