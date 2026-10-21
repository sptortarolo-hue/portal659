import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { fetchOperatorCarriers } from "@/lib/shipping-server";
import {
  formatShipmentCode,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/lib/shipping";
import {
  OPERATOR_TRANSITIONS,
  shipmentsReady,
  podColumnsReady,
  validateDeliveryCertificate,
  applyAdvanceTx,
  syncAndNotify,
} from "@/lib/shipment-handoff";
import { geocodeAddress, geocodeAddressesBatch } from "@/lib/geocode";

export const dynamic = "force-dynamic";

/**
 * API del operador de logística (portal interno "Portal 659 Envíos"):
 * lista encargos pendientes/en curso de su carrier y avanza el estado con
 * certificado de entrega (quién + DNI + GPS). Auth por login normal del
 * portal (operador registrado en carrier_operators, resuelto por profile id).
 * Las reglas de transición / SQL / notificaciones viven compartidas en
 * `@/lib/shipment-handoff` (también la usa la hoja del repartidor sin login).
 */

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!(await shipmentsReady())) {
    return NextResponse.json({ shipments: [], ready: false, carriers: [] });
  }
  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) {
    return NextResponse.json({ shipments: [], ready: true, carriers: [] });
  }
  const carrierIds = carriers.map((c) => c.id);

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT s.id, s.order_id, s.code, s.status, s.note, s.failed_reason, s.pod_photo_url,
            s.shipping_zone_name, s.requested_at, s.picked_up_at, s.delivered_at, s.created_at,
            s.dest_lat, s.dest_lng,
            s.delivered_to_name, s.delivered_dni, s.delivered_lat, s.delivered_lng, s.delivered_geo_ok,
            o.total, o.customer_name, o.customer_phone, o.customer_address,
            o.items, o.status AS order_status, o.delivery_window, o.pickup_number,
            v.store_name, v.slug AS store_slug, v.location AS store_address,
            v.lat AS vendor_lat, v.lng AS vendor_lng, v.whatsapp AS vendor_whatsapp, v.phone AS vendor_phone,
            c.name AS carrier_name
     FROM shipments s
     JOIN orders o ON o.id = s.order_id
     JOIN vendors v ON v.id = s.vendor_id
     LEFT JOIN carriers c ON c.id = s.carrier_id
     WHERE (s.carrier_id = ANY($1::uuid[])
        OR (s.carrier_id IS NULL AND s.shipping_zone_id IS NULL))
     ORDER BY s.requested_at ASC
     LIMIT 300`,
    [carrierIds]
  );

  const shipments = (rows || []).map((r) => {
    const coordAlt = r.dest_lat != null && r.dest_lng != null
      ? { lat: Number(r.dest_lat), lng: Number(r.dest_lng) }
      : null;
    return {
      id: String(r.id),
      orderId: r.order_id != null ? String(r.order_id) : null,
      code: formatShipmentCode(String(r.code)),
      status: String(r.status),
      statusLabel:
        SHIPMENT_STATUS_LABELS[String(r.status) as keyof typeof SHIPMENT_STATUS_LABELS] ||
        String(r.status),
      note: r.note != null ? String(r.note) : null,
      failedReason: r.failed_reason != null ? String(r.failed_reason) : null,
      zoneName: r.shipping_zone_name != null ? String(r.shipping_zone_name) : null,
      requestedAt: r.requested_at,
      storeName: r.store_name != null ? String(r.store_name) : null,
      storeSlug: r.store_slug != null ? String(r.store_slug) : null,
      storeAddress: r.store_address != null ? String(r.store_address) : null,
      vendorLat: r.vendor_lat != null ? Number(r.vendor_lat) : null,
      vendorLng: r.vendor_lng != null ? Number(r.vendor_lng) : null,
      vendorWhatsapp: r.vendor_whatsapp != null ? String(r.vendor_whatsapp) : null,
      vendorPhone: r.vendor_phone != null ? String(r.vendor_phone) : null,
      carrierName: r.carrier_name != null ? String(r.carrier_name) : null,
      customerName: r.customer_name != null ? String(r.customer_name) : null,
      customerPhone: r.customer_phone != null ? String(r.customer_phone) : null,
      customerAddress: r.customer_address != null ? String(r.customer_address) : null,
      destCoords: coordAlt,
      destLat: coordAlt ? coordAlt.lat : null,
      destLng: coordAlt ? coordAlt.lng : null,
      deliveryWindow: r.delivery_window != null ? String(r.delivery_window) : null,
      orderNumber: r.pickup_number != null ? Number(r.pickup_number) : null,
      items: Array.isArray(r.items) ? r.items : [],
      total: Number(r.total) || 0,
      orderStatus: r.order_status != null ? String(r.order_status) : null,
      // Certificado de entrega (visible después de delivered).
      deliveredToName: r.delivered_to_name != null ? String(r.delivered_to_name) : null,
      deliveredDni: r.delivered_dni != null ? String(r.delivered_dni) : null,
      deliveredLat: r.delivered_lat != null ? Number(r.delivered_lat) : null,
      deliveredLng: r.delivered_lng != null ? Number(r.delivered_lng) : null,
      deliveredGeoOk: r.delivered_geo_ok === true,
    };
  });

  // Geocoding perezoso (tolerante): hasta 3 direcciones pendientes por request.
  // Si las columnas dest_* no existen (migración sin aplicar), el UPDATE cae en
  // el catch de tryShipmentSetCoords y no rompe el listado.
  const pending = shipments.filter(
    (s) => s.destCoords === null && (s.status === "requested" || s.status === "picked_up" || s.status === "in_transit") && s.customerAddress
  );
  if (pending.length > 0) {
    await geocodeAddressesBatch(pending.map((s) => buildGeoQuery(s.customerAddress, s.zoneName)), 3);
    for (const s of pending) {
      const coords = await geocodeAddress(buildGeoQuery(s.customerAddress, s.zoneName));
      if (coords) await tryShipmentSetCoords(s.id, coords);
    }
  }

  return NextResponse.json({ shipments, ready: true, carriers });
}

/** Query de Nominatim: dirección + contexto del barrio (mejora aciertos). */
function buildGeoQuery(address: string | null, zoneName: string | null): string {
  return [address, zoneName, "Buenos Aires", "Argentina"].filter(Boolean).join(", ");
}

/** Guarda dest_lat/lng si la migración está aplicada (best-effort). */
async function tryShipmentSetCoords(
  shipmentId: string,
  coords: { lat: number; lng: number }
): Promise<void> {
  try {
    await queryOne(
      `UPDATE shipments SET dest_lat = $2, dest_lng = $3 WHERE id = $1`,
      [shipmentId, coords.lat, coords.lng]
    );
  } catch {
    /* columna sin migrar: sin pin */
  }
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (!(await shipmentsReady())) {
    return NextResponse.json(
      { error: "Falta aplicar la migración de envíos (migrate-portal-shipments.sql)" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const shipmentId = String(body?.shipmentId ?? "").trim();
  const status = String(body?.status ?? "").trim();
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;
  const podPhotoUrl = typeof body?.podPhotoUrl === "string" && body.podPhotoUrl ? body.podPhotoUrl.trim() : null;
  if (!shipmentId || !status) {
    return NextResponse.json({ error: "Faltan el envío o el estado" }, { status: 400 });
  }
  if (!(status in SHIPMENT_STATUS_LABELS)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }
  // Certificado de entrega (solo si la migración v2 está; legacy tolera).
  const podEnforced = status === "delivered" && (await podColumnsReady());
  const cert = validateDeliveryCertificate(status, body, podEnforced);
  if (cert.error) {
    return NextResponse.json({ error: cert.error }, { status: 400 });
  }

  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) {
    return NextResponse.json({ error: "No sos operador de ninguna logística" }, { status: 403 });
  }

  // Valida el encargo + transición (regla dura: Entregar exige En camino).
  const current = await loadOperatorShipment(shipmentId);
  if (!current) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
  const allowed = OPERATOR_TRANSITIONS[current.status] || [];
  if (!allowed.includes(status as ShipmentStatus)) {
    return NextResponse.json(
      { error: `No podés pasar de '${current.status}' a '${status}'` },
      { status: 409 }
    );
  }

  // Foto POD: URL que ya subió el form (tolerante, hasta 500 chars http).
  let photoUrl: string | null = null;
  if (podPhotoUrl && podPhotoUrl.length <= 500 && podPhotoUrl.startsWith("http")) {
    photoUrl = podPhotoUrl;
  }

  try {
    await applyAdvanceTx({
      shipmentId,
      status,
      carrierId: carriers[0].id,
      note,
      photoUrl,
      operatorProfileId: user.id,
      courierName: null,
      podEnforced,
      cert: cert.cert,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo actualizar el envío: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  // Estado del pedido sincronizado + push/mail comercio-comprador (best-effort).
  const sync = await syncAndNotify(current, status, note);
  return NextResponse.json({ ok: true, status, statusLabel: SHIPMENT_STATUS_LABELS[status as ShipmentStatus] || status, orderSynced: sync.applied });
}

/** Shipment + is_preview del pedido (para la transición y los avisos). */
async function loadOperatorShipment(
  shipmentId: string
): Promise<{ id: string; order_id: string; code: string; carrier_id: string | null; vendor_id: string; status: string; is_preview: boolean | null } | null> {
  try {
    const row = await queryOne<{
      id: string;
      order_id: string;
      code: string;
      carrier_id: string | null;
      vendor_id: string;
      status: string;
      is_preview: boolean | null;
    }>(
      `SELECT s.id, s.order_id, s.code, s.carrier_id, s.vendor_id, s.status,
              o.is_preview
       FROM shipments s JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1 LIMIT 1`,
      [shipmentId]
    );
    return row || null;
  } catch {
    return null;
  }
}
