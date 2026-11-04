import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { buildWeighedOrderMessage } from "@/lib/whatsapp-message";

/**
 * Flujo de pesada (modo "confirmar"): mensaje al cliente con el pedido
 * PREPARADO Y PESADO — detalle con el peso real, el total real y los datos para
 * pagar según el método elegido en el checkout:
 *   - mercadopago  → link al seguimiento, donde paga con MP (valida tolerancia).
 *   - transferencia → alias/CBU/titular del comercio + monto exacto.
 *   - efectivo      → "pagar al recibir".
 *   - whatsapp/otro → "coordinamos el pago por este chat".
 *
 * Se usa en dos lugares:
 *   1. Automático, al confirmar el peso en el PATCH de pedidos (best-effort).
 *   2. Manual, desde "📲 Enviar pedido pesado por WhatsApp" (reenvío).
 *
 * Tolerante a migración sin aplicar: sin las columnas de peso responde
 * `not_ready` (nunca manda un mensaje a medias).
 */
export type SendWeighedResult = {
  ok: boolean;
  /** El bot aceptó el envío (puede seguir sin entregar si no hay sesión WA). */
  sent?: boolean;
  /** Motivo del bot cuando no envió (ej. "no_session"). */
  reason?: string | null;
  /** Texto armado (para el fallback a wa.me del panel). */
  text?: string;
  error?: string;
  /** Código de error para mapear a HTTP en la ruta manual. */
  code?:
    | "not_found"
    | "not_ready"
    | "paid"
    | "not_pending"
    | "no_phone";
};

type OrderRow = {
  id: string;
  vendor_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  items: unknown;
  total: number | string | null;
  payment_method: string;
  payment_status: string;
  pickup_number: number | null;
  track_token: string | null;
  method: string;
  weight_confirmed_at: string | null;
  weight_estimated_total: number | string | null;
};

export async function sendWeighedOrder(args: {
  vendorId: string;
  orderId: string;
}): Promise<SendWeighedResult> {
  const { vendorId, orderId } = args;

  const order = await queryOne<OrderRow>(
    `SELECT id, vendor_id, customer_name, customer_phone, items, total, payment_method, payment_status,
            pickup_number, track_token, method,
            CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_confirmed_at')
              THEN weight_confirmed_at ELSE NULL END AS weight_confirmed_at,
            CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_estimated_total')
              THEN weight_estimated_total ELSE NULL END AS weight_estimated_total
     FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendorId]
  );
  if (!order) return { ok: false, code: "not_found", error: "Pedido no encontrado" };

  // Solo aplica al flujo de pesada: nació "pendiente de peso" y ya se confirmó.
  if (order.weight_estimated_total == null || !order.weight_confirmed_at) {
    return {
      ok: false,
      code: "not_ready",
      error: "Este pedido no está en el flujo de pesada o todavía no confirmaste el peso",
    };
  }
  // Efectivo/coordinar: el pedido nace "paid" (se cobra al entregar) y el
  // comercio igual puede avisar el monto real ("pagás $X al recibir").
  // Transferencia/MP: exigen que siga pendiente — si ya pagó, el mensaje de
  // cobro ya no tiene sentido.
  const needsPending =
    order.payment_method === "transferencia" || order.payment_method === "mercadopago";
  if (needsPending && order.payment_status === "paid") {
    return { ok: false, code: "paid", error: "El pedido ya está pagado" };
  }
  if (!order.customer_phone || order.customer_phone.startsWith("lid:")) {
    return { ok: false, code: "no_phone", error: "El pedido no tiene teléfono del cliente" };
  }
  if (needsPending && order.payment_status !== "pending") {
    return { ok: false, code: "not_pending", error: "El pedido ya no está pendiente de pago" };
  }

  const vendorRow = await queryOne<{
    store_name: string;
    transfer_alias: string | null;
    transfer_cbu: string | null;
    transfer_holder: string | null;
  }>(
    `SELECT store_name, transfer_alias, transfer_cbu, transfer_holder FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  ).catch(() => null);

  const items = Array.isArray(order.items) ? (order.items as any[]) : [];
  const total = Number(order.total) || 0;
  const estimated = Number(order.weight_estimated_total) || 0;
  const trackUrl = order.track_token ? `${getSiteUrl()}/seguimiento/${order.track_token}` : null;
  const orderLabel =
    order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`;

  const text = buildWeighedOrderMessage({
    vendorName: vendorRow?.store_name || "El comercio",
    customerName: order.customer_name || "cliente",
    orderLabel,
    items: items.map((i) => ({
      name: String(i?.name || "producto"),
      price: Number(i?.price) || 0,
      qty: Number(i?.qty) || 0,
      modifiers: Array.isArray(i?.modifiers) ? i.modifiers : [],
      unit: i?.unit === "kg" ? "kg" : undefined,
    })),
    total,
    paymentMethod: order.payment_method,
    alias: vendorRow?.transfer_alias ?? null,
    cbu: vendorRow?.transfer_cbu ?? null,
    holder: vendorRow?.transfer_holder ?? null,
    trackUrl,
    changedFromEstimate: estimated > 0 && Math.abs(total - estimated) > 0.01,
  });

  const wabotUrl = (process.env.WABOT_URL || "http://wabot:8792").replace(/\/$/, "");
  const r = await fetch(`${wabotUrl}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}`,
    },
    body: JSON.stringify({
      vendorId,
      waId: order.customer_phone,
      text,
      orderId,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) {
    return {
      ok: false,
      error: "El bot no está conectado (el celular está apagado o sin señal)",
      text,
    };
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, error: data.error || "No se pudo enviar", text };
  }
  return { ok: true, sent: data.sent === true, reason: data.reason || null, text };
}
