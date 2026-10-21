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
            o.total, o.customer_name, o.customer_phone, o.customer_address,
            o.items, o.status AS order_status,
            v.store_name, v.slug AS store_slug, v.location AS store_address
     FROM shipments s
     JOIN orders o ON o.id = s.order_id
     JOIN vendors v ON v.id = s.vendor_id
     WHERE (s.carrier_id = ANY($1::uuid[])
        OR (s.carrier_id IS NULL AND s.shipping_zone_id IS NULL))
     ORDER BY s.requested_at ASC
     LIMIT 300`,
    [carrierIds]
  );

  const shipments = (rows || []).map((r) => ({
    id: String(r.id),
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
    customerName: r.customer_name != null ? String(r.customer_name) : null,
    customerPhone: r.customer_phone != null ? String(r.customer_phone) : null,
    customerAddress: r.customer_address != null ? String(r.customer_address) : null,
    items: Array.isArray(r.items) ? r.items : [],
    total: Number(r.total) || 0,
    orderStatus: r.order_status != null ? String(r.order_status) : null,
  }));

  return NextResponse.json({ shipments, ready: true, carriers });
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
      // 6 params → bind 500 en in_transit/failed_attempt).
      await tx.queryVoid(
        `UPDATE shipments SET status = $2, carrier_id = COALESCE(carrier_id, $3),
              failed_reason = $4,
              picked_up_at = CASE WHEN $5 THEN now() ELSE picked_up_at END,
              delivered_at = CASE WHEN $6 THEN now() ELSE delivered_at END,
              pod_photo_url = COALESCE($7, pod_photo_url)
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
