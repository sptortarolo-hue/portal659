import { queryOne, withTransaction } from "./db";
import { sendPushToUser } from "./push";
import { sendEmail, reviewRequestEmail } from "./email";
import { getSiteUrl } from "./site-url";
import { phoneVariantsAR } from "./phone";
import {
  formatShipmentCode,
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "./shipping";
import { syncOrderForShipmentStatus } from "./shipping-server";

export type ShipmentStatusValue = string;

/**
 * Reglas de transición compartidas operador / repartidor (v3):
 * flow realista de reparto — "Entregar" exige haber marcado En camino
 * (no se saltea Colectado→Entregado ni Reintentar→Entregado).
 */
export const OPERATOR_TRANSITIONS: Record<string, ShipmentStatus[]> = {
  requested: ["picked_up", "returned", "cancelled"],
  picked_up: ["in_transit", "failed_attempt", "returned"],
  in_transit: ["delivered", "failed_attempt"],
  failed_attempt: ["in_transit", "returned", "cancelled"],
};

/** Sin login (escaneo del paquete): solo estados "tengo el paquete encima". */
export const HANDOFF_TRANSITIONS: Record<string, ShipmentStatus[]> = {
  picked_up: ["in_transit", "failed_attempt", "returned"],
  in_transit: ["delivered", "failed_attempt"],
  failed_attempt: ["in_transit", "returned"],
};

/** Migraciones base (tolerantes): tabla shipments y columnas del certificado. */
let shippedOk: boolean | null = null;
export async function shipmentsReady(): Promise<boolean> {
  if (shippedOk !== null) return shippedOk;
  try {
    await queryOne(`SELECT 1 FROM shipments LIMIT 1`);
    shippedOk = true;
  } catch {
    shippedOk = false;
  }
  return shippedOk;
}

let podOk: boolean | null = null;
export async function podColumnsReady(): Promise<boolean> {
  if (podOk !== null) return podOk;
  try {
    await queryOne(`SELECT delivered_dni FROM shipments LIMIT 1`);
    podOk = true;
  } catch {
    podOk = false;
  }
  return podOk;
}

/** "ENV-WPB6FP"|"wpb6fp" → "WPB6FP" (la DB guarda el código pelado). */
export function normalizeShipmentCode(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/^ENV-/, "")
    .replace(/\s+/g, "");
}

export type ShipmentRef = {
  id: string;
  order_id: string;
  code: string;
  carrier_id: string | null;
  vendor_id: string;
  status: ShipmentStatusValue;
  is_preview: boolean | null;
};

/** Carga el envío por id o por código (acepta el formato con prefijo). */
export async function loadShipmentForAdvance(ref: {
  id?: string;
  code?: string;
}): Promise<ShipmentRef | null> {
  let row: ShipmentRef | undefined;
  try {
    row = await queryOne<ShipmentRef>(
      `SELECT s.id, s.order_id, s.code, s.carrier_id, s.vendor_id, s.status,
              o.is_preview
       FROM shipments s JOIN orders o ON o.id = s.order_id
       WHERE ${ref.id ? "s.id = $1" : `s.code = $1`} LIMIT 1`,
      [ref.id || ref.code]
    );
  } catch {
    return null; // migración pendiente
  }
  return row || null;
}

export type DeliveryCert = {
  name: string;
  dni: string;
  lat: number;
  lng: number;
};

/**
 * Valida el certificado de entrega (patrón Mercado Envíos: identidad por
 * número de DNI — JAMÁS foto del documento/persona; GPS del celular exigido).
 * Solo aplica con la migración v2 aplicada (legacy: acepta sin certificado).
 */
export function validateDeliveryCertificate(
  status: string,
  body: Record<string, unknown>,
  podEnforced: boolean
): { cert: DeliveryCert | null; error: string | null } {
  if (status !== "delivered" || !podEnforced) return { cert: null, error: null };
  const nameRaw = typeof body?.deliveredToName === "string" ? body.deliveredToName.trim() : "";
  const dniRaw = typeof body?.deliveredDni === "string" ? body.deliveredDni.replace(/\D/g, "") : "";
  const lat = Number(body?.deliveredLat);
  const lng = Number(body?.deliveredLng);
  if (nameRaw.length < 3 || nameRaw.length > 80) {
    return { cert: null, error: "Falta el nombre de quien recibió el paquete" };
  }
  if (!/^\d{7,9}$/.test(dniRaw)) {
    return { cert: null, error: "Falta el DNI de quien recibió (solo números, sin puntos)" };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { cert: null, error: "Falta la ubicación del celular (activá el GPS para certificar la entrega)" };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { cert: null, error: "La ubicación no es válida (reintentá activar el GPS)" };
  }
  return { cert: { name: nameRaw, dni: dniRaw, lat, lng }, error: null };
}

export type AdvanceInput = {
  shipmentId: string;
  status: string;
  carrierId: string | null;
  note: string | null;
  photoUrl: string | null;
  /** profile id (operador logueado) o null (repartidor sin login). */
  operatorProfileId: string | null;
  /** Nombre libre del repartidor (traspaso entre repartidores sin login). */
  courierName: string | null;
  podEnforced: boolean;
  cert: DeliveryCert | null;
};

/**
 * Ejecuta la transición: UPDATE del encargo + evento de timeline.
 * El SQL usa CASE/COALESCE para guardar el certificado solo en delivered.
 */
export async function applyAdvanceTx(input: AdvanceInput): Promise<void> {
  const { shipmentId, status, carrierId, note, photoUrl, operatorProfileId, courierName, podEnforced, cert } = input;
  await withTransaction(async (tx) => {
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
        carrierId,
        status === "failed_attempt" || status === "returned"
          ? note || null
          : null,
        status === "picked_up",
        status === "delivered",
        photoUrl,
        status === "delivered" && podEnforced,
        status === "delivered" && podEnforced ? cert?.name?.slice(0, 80) : null,
        status === "delivered" && podEnforced ? cert?.dni : null,
        status === "delivered" && podEnforced ? cert?.lat : null,
        status === "delivered" && podEnforced ? cert?.lng : null,
      ]
    );
    await tx.queryVoid(
      `INSERT INTO shipment_events (shipment_id, status, note, photo_url, operator_profile_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [shipmentId, status, eventNote(note, courierName), photoUrl, operatorProfileId]
    );
  });
}

/** Nota del evento: la nota + "por X" del courier (traspaso legible). Sin GPS. */
function eventNote(note: string | null, courierName: string | null): string | null {
  const parts = [];
  if (note) parts.push(note.trim().slice(0, 260));
  if (courierName) parts.push(`por ${courierName.trim().slice(0, 60)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Efectos compartidos después de la transición (tolerantes, nunca bloquean):
 * 1) sincroniza el pedido (mapeo de estados) 2) push al comercio y al
 * comprador (+ mail de reseña en delivered). Devuelve si el sync aplicó.
 */
export async function syncAndNotify(
  current: { order_id: string; code: string; vendor_id: string; is_preview: boolean | null },
  status: string,
  note: string | null
): Promise<{ applied: boolean }> {
  const sync = await syncOrderForShipmentStatus(current.order_id, status);
  try {
    const vendorRow: { user_id: string | null; store_name: string | null; store_slug: string | null } | undefined =
      current.vendor_id
        ? (await queryOne<Record<string, unknown>>(
            `SELECT user_id, store_name, slug AS store_slug FROM vendors WHERE id = $1 LIMIT 1`,
            [current.vendor_id]
          )) as { user_id: string | null; store_name: string | null; store_slug: string | null } | undefined
        : undefined;
    const codePub = formatShipmentCode(current.code);

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

    if (current.order_id && current.is_preview !== true) {
      const orderInfo = await queryOne<{ id: string; customer_phone: string | null; customer_name: string | null }>(
        `SELECT id, customer_phone, customer_name FROM orders WHERE id = $1 LIMIT 1`,
        [current.order_id]
      );
      if (orderInfo && (orderInfo.customer_phone || "").trim()) {
        const buyerText = buyerShipmentText(status, codePub, vendorRow?.store_name || null);
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
    /* notificaciones best-effort */
  }
  return { applied: sync.applied };
}

/** Textos de aviso al comprador por evento de reparto (null = sin aviso). */
export function buyerShipmentText(
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
