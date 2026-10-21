import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  syncOrderForShipmentStatus,
  fetchOperatorCarriers,
} from "@/lib/shipping-server";
import {
  formatShipmentCode,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/lib/shipping";
import { phoneVariantsAR } from "@/lib/phone";
import { sendPushToUser } from "@/lib/push";
import { getSiteUrl } from "@/lib/site-url";
import { sendEmail, reviewRequestEmail } from "@/lib/email";
import { geocodeAddress, geocodeAddressesBatch } from "@/lib/geocode";

export const dynamic = "force-dynamic";

/**
 * API del operador de logística (portal interno "Portal 659 Envíos" v1):
 * lista encargos pendientes/en curso de su carrier y avanza el estado con
 * foto de prueba de entrega opcional (POD). Auth por login normal del portal
 * (operador registrado en carrier_operators, resuelto por profile id).
 */

const ALLOWED_NEXT: Record<string, ShipmentStatus[]> = {
  requested: ["picked_up", "in_transit", "returned", "cancelled"],
  picked_up: ["in_transit", "delivered", "failed_attempt", "returned"],
  in_transit: ["delivered", "failed_attempt"],
  failed_attempt: ["in_transit", "delivered", "returned", "cancelled"],
};

let migratedOk: boolean | null = null;
async function shipmentsReady(): Promise<boolean> {
  if (migratedOk !== null) return migratedOk;
  try {
    await queryOne(`SELECT 1 FROM shipments LIMIT 1`);
    migratedOk = true;
  } catch {
    migratedOk = false;
  }
  return migratedOk;
}

// Certificado v2 (migrate-shipments-pod.sql): probe una sola vez.
let podOk: boolean | null = null;
async function podColumnsReady(): Promise<boolean> {
  if (podOk !== null) return podOk;
  try {
    await queryOne(`SELECT delivered_dni FROM shipments LIMIT 1`);
    podOk = true;
  } catch {
    podOk = false;
  }
  return podOk;
}

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
  // Certificado de entrega ("recibió X, DNI n, GPS lat/lng" — patrón Mercado
  // Envíos: identidad por número, JAMÁS foto del documento ni de la persona).
  const deliveredToNameRaw = typeof body?.deliveredToName === "string" ? body.deliveredToName.trim() : "";
  const deliveredDniRaw = typeof body?.deliveredDni === "string" ? body.deliveredDni.replace(/\D/g, "") : "";
  const deliveredLat = Number(body?.deliveredLat);
  const deliveredLng = Number(body?.deliveredLng);
  if (!shipmentId || !status) {
    return NextResponse.json({ error: "Faltan el envío o el estado" }, { status: 400 });
  }
  if (!(status in SHIPMENT_STATUS_LABELS)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }
  // Exigencia solo si la migración está aplicada; legacy (sin columnas) acepta
  // la entrega sin certificado para no trabar la operación.
  const podEnforced = status === "delivered" && (await podColumnsReady());
  if (podEnforced) {
    if (deliveredToNameRaw.length < 3 || deliveredToNameRaw.length > 80) {
      return NextResponse.json(
        { error: "Falta el nombre de quien recibió el paquete" },
        { status: 400 }
      );
    }
    if (!/^\d{7,9}$/.test(deliveredDniRaw)) {
      return NextResponse.json(
        { error: "Falta el DNI de quien recibió (solo números, sin puntos)" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(deliveredLat) || !Number.isFinite(deliveredLng)) {
      return NextResponse.json(
        { error: "Falta la ubicación del celular (activá el GPS para certificar la entrega)" },
        { status: 400 }
      );
    }
    if (deliveredLat < -90 || deliveredLat > 90 || deliveredLng < -180 || deliveredLng > 180) {
      return NextResponse.json(
        { error: "La ubicación no es válida (reintentá activar el GPS)" },
        { status: 400 }
      );
    }
  }

  const carriers = await fetchOperatorCarriers(user.id);
  if (carriers.length === 0) {
    return NextResponse.json({ error: "No sos operador de ninguna logística" }, { status: 403 });
  }

  // Valida el encargo + transición.
  let current:
    | {
        status: string;
        order_id: string;
        code: string;
        carrier_id: string | null;
        vendor_id: string;
        is_preview: boolean | null;
      }
    | undefined;
  try {
    const row = await queryOne<{
      status: string;
      order_id: string;
      code: string;
      carrier_id: string | null;
      vendor_id: string;
      is_preview: boolean | null;
    }>(
      `SELECT s.status, s.order_id, s.code, s.carrier_id, s.vendor_id,
              o.is_preview
       FROM shipments s JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1 LIMIT 1`,
      [shipmentId]
    );
    current = row ?? undefined;
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración de envíos (migrate-portal-shipments.sql)" },
      { status: 503 }
    );
  }
  if (!current) return NextResponse.json({ error: "Envío no encontrado" }, { status: 404 });
  const allowed = ALLOWED_NEXT[current.status] || [];
  if (!allowed.includes(status as ShipmentStatus)) {
    return NextResponse.json(
      { error: `No podés pasar de '${current.status}' a '${status}'` },
      { status: 409 }
    );
  }

  // Foto POD: sube por el upload público del servicio si viene como data URL.
  // En v1 guardamos la URL que viene (el form del panel sube por /api/uploads
  // y pasa la URL final) y solo toleramos hasta 500 chars.
  let photoUrl: string | null = null;
  if (podPhotoUrl && podPhotoUrl.length <= 500 && podPhotoUrl.startsWith("http")) {
    photoUrl = podPhotoUrl;
  }

  try {
    await withTransaction(async (tx) => {
      // SQL única (los $5/$6/$7 con CASE/COALESCE aplican timestamps y POD
      // solo cuando toca — antes el ternario armaba una SQL corta pero mandaba
      // 6 params → bind 500 en in_transit/failed_attempt). El certificado de
      // entrega (quién/DNI/GPS) se escribe solo en delivered (podEnforced).
      await tx.queryVoid(
        `UPDATE shipments SET status = $2, carrier_id = COALESCE(carrier_id, $3),
              failed_reason = $4,
              picked_up_at = CASE WHEN $5 THEN now() ELSE picked_up_at END,
              delivered_at = CASE WHEN $6 THEN now() ELSE delivered_at END,
              pod_photo_url = COALESCE($7, pod_photo_url),
              delivered_to_name = CASE WHEN $6 AND $8 THEN $9 ELSE delivered_to_name END,
              delivered_dni = CASE WHEN $6 AND $8 THEN $10 ELSE delivered_dni END,
              delivered_lat = CASE WHEN $6 AND $8 THEN $11 ELSE delivered_lat END,
              delivered_lng = CASE WHEN $6 AND $8 THEN $12 ELSE delivered_lng END,
              delivered_geo_ok = CASE WHEN $6 AND $8 THEN true ELSE delivered_geo_ok END
            WHERE id = $1`,
        [
          shipmentId,
          status,
          carriers[0].id,
          status === "failed_attempt" || status === "returned"
            ? note || null
            : null,
          status === "picked_up",
          status === "delivered",
          photoUrl,
          // $8 cert aplica: solo cuando delivered y la migración v2 está (el
          // request trajo nombre DNI y GPS validados antes).
          status === "delivered" && podEnforced,
          status === "delivered" && podEnforced ? deliveredToNameRaw.slice(0, 80) : null,
          status === "delivered" && podEnforced ? deliveredDniRaw : null,
          status === "delivered" && podEnforced ? deliveredLat : null,
          status === "delivered" && podEnforced ? deliveredLng : null,
        ]
      );
      await tx.queryVoid(
        `INSERT INTO shipment_events (shipment_id, status, note, photo_url, operator_profile_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          shipmentId,
          status,
          note,
          photoUrl,
          user.id,
        ]
      );
    });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo actualizar el envío: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  // Estado del pedido sincronizado (tolerante, ver helper). Devuelve el
  // resultado para que el operador sepa si hubo mapeo. OJO: el helper pide
  // el ORDER id (antes pasábamos el shipment id y el sync nunca aplicaba).
  const sync = await syncOrderForShipmentStatus(current.order_id, status);

  // Push + email al comercio y/o al comprador según el evento (best-effort:
  // nunca bloquea la operación del operador).
  try {
    const vendorRow = current.vendor_id
      ? await queryOne<{ user_id: string | null; store_name: string | null; store_slug: string | null }>(
          `SELECT user_id, store_name, slug AS store_slug FROM vendors WHERE id = $1 LIMIT 1`,
          [current.vendor_id]
        )
      : undefined;
    const codePub = formatShipmentCode(current.code);

    // Al comercio: cuando cambia el estado del pedido (mapeo) o cuando el
    // reparto falla (no llega push de mapeo, pero el dueño tiene que saber).
    if (
      vendorRow?.user_id &&
      (sync.applied || status === "failed_attempt") &&
      current.is_preview !== true
    ) {
      await sendPushToUser(vendorRow.user_id, {
        title: `🚚 ${vendorRow.store_name || "Envío"}: ${SHIPMENT_STATUS_LABELS[status as ShipmentStatus] || status}`,
        body:
          status === "failed_attempt"
            ? note || "La logística no pudo entregar (sin exitosa). Reintentan mañana."
            : "Portal 659 Envíos actualizó el estado del encargo.",
        link: "/vendor/dashboard",
      });
    }

    // Al comprador: cada evento del reparto (por teléfono del pedido →
    // perfil; link de seguimiento público /envio/CODE). Los envíos de prueba
    // no notifican ni mandan mails.
    if (current.order_id && current.is_preview !== true) {
      const orderInfo = await queryOne<{
        id: string;
        customer_phone: string | null;
        customer_name: string | null;
      }>(
        `SELECT id, customer_phone, customer_name
         FROM orders WHERE id = $1 LIMIT 1`,
        [current.order_id]
      );
      if (orderInfo && (orderInfo.customer_phone || "").trim()) {
        const buyerText = buyerShipmentText(
          status,
          codePub,
          vendorRow?.store_name || null
        );
        if (buyerText) {
          const variants = phoneVariantsAR(orderInfo.customer_phone || "");
          const buyer = variants
            ? await queryOne<{ id: string; email: string | null }>(
                `SELECT id, email FROM profiles
                 WHERE phone = ANY($1::text[]) OR whatsapp = ANY($1::text[])
                 ORDER BY id LIMIT 1`,
                [variants]
              )
            : undefined;
          if (buyer) {
            await queryOne(
              `INSERT INTO notifications (user_id, title, body, type, link)
               VALUES ($1, $2, $3, 'order', $4)`,
              [buyer.id, buyerText.title, buyerText.body, buyerText.link]
            );
            await sendPushToUser(buyer.id, buyerText);
            // Entregado → mail de reseña (mismo patrón que el PATCH de pedidos).
            if (status === "delivered" && buyer.email && vendorRow?.store_slug) {
              try {
                const reviewUrl = `${getSiteUrl()}/tienda/${vendorRow.store_slug}`;
                const reviewMail = reviewRequestEmail(vendorRow.store_name || "tu pedido", reviewUrl);
                await sendEmail({ to: buyer.email, subject: reviewMail.subject, html: reviewMail.html });
              } catch {
                /* email best-effort */
              }
            }
          }
        }
      }
    }
  } catch {
    // Notifications best-effort.
  }

  return NextResponse.json({ ok: true, status, statusLabel: SHIPMENT_STATUS_LABELS[status as ShipmentStatus] || status, orderSynced: sync.applied });
}

/** Textos de aviso al comprador por evento de reparto (null = sin aviso). */
function buyerShipmentText(
  status: string,
  code: string,
  storeName: string | null
): { title: string; body: string; link: string } | null {
  const link = `/envio/${encodeURIComponent(code)}`;
  const tienda = storeName ? ` de ${storeName}` : "";
  switch (status) {
    case "picked_up":
    case "in_transit":
      return {
        title: `🚚 Tu pedido${tienda} salió`,
        body: `El paquete ${code} ya está en camino. Seguimiento: ${getSiteUrl().replace(/^https?:\/\//, "")}${link}`,
        link,
      };
    case "delivered":
      return {
        title: `✅ Entregado: tu pedido${tienda}`,
        body: `Recibiste el paquete ${code}. ¿Todo ok? Dejanos tu reseña.`,
        link,
      };
    case "failed_attempt":
      return {
        title: `⚠️ No pudimos entregar tu pedido${tienda}`,
        body: `El paquete ${code} volvió al depósito. Coordinamos el reintento con el comercio.`,
        link,
      };
    case "returned":
      return {
        title: `↩️ Devuelto al comercio`,
        body: `El pedido ${code} no llegó a entregarse y volvió al comercio.`,
        link,
      };
    default:
      return null; // requested/cancelled: sin push al comprador.
  }
}
