import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { buildWeighedOrderMessage } from "@/lib/whatsapp-message";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * POST /api/vendor/orders/[id]/send-weighed-order — el comercio aprieta
 * "📲 Enviar pedido pesado por WhatsApp" tras confirmar el peso real. Manda el
 * detalle con los kilos reales, el total real y la acción de pago según el
 * método (efectivo: cuánto paga al recibir · transferencia: alias/CBU + monto ·
 * MP: link al seguimiento). Manual a propósito: controlando el monto que sale.
 * Tolerante a migración sin aplicar: sin las columnas de peso responde 503
 * nombrando la migración (nunca manda un mensaje a medias).
 */
export const POST = withRateLimit(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params;
    const { vendor } = await getVendorByRequest(request);
    if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const order = await queryOne<{
      id: string;
      customer_name: string | null;
      customer_phone: string | null;
      items: unknown;
      total: number;
      payment_method: string;
      payment_status: string;
      pickup_number: number | null;
      track_token: string | null;
      weight_confirmed_at: string | null;
      weight_estimated_total: number | null;
    }>(
      `SELECT id, customer_name, customer_phone, items, total, payment_method, payment_status,
              pickup_number, track_token,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_confirmed_at')
                THEN weight_confirmed_at ELSE NULL END AS weight_confirmed_at,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_estimated_total')
                THEN weight_estimated_total ELSE NULL END AS weight_estimated_total
       FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [params.id, vendor.id]
    );
    if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

    // Solo aplica al flujo de pesada: nació "pendiente de peso" y ya se confirmó.
    if (order.weight_estimated_total == null || !order.weight_confirmed_at) {
      return NextResponse.json(
        { error: "Este pedido no está en el flujo de pesada o todavía no confirmaste el peso" },
        { status: 400 }
      );
    }
    if (order.payment_status === "paid") {
      return NextResponse.json({ error: "El pedido ya está pagado" }, { status: 400 });
    }
    if (!order.customer_phone || order.customer_phone.startsWith("lid:")) {
      return NextResponse.json({ error: "El pedido no tiene teléfono del cliente" }, { status: 400 });
    }
    // Efectivo/coordinar: el pedido nace "paid" (se cobra al entregar), pero el
    // comercio igual puede avisar el monto real. Transferencia/MP: exige pendiente.
    const needsPending = order.payment_method === "transferencia" || order.payment_method === "mercadopago";
    if (needsPending && order.payment_status !== "pending") {
      return NextResponse.json({ error: "El pedido ya no está pendiente de pago" }, { status: 400 });
    }

    const vendorRow = await queryOne<{ store_name: string; transfer_alias: string | null; transfer_cbu: string | null; transfer_holder: string | null }>(
      `SELECT store_name, transfer_alias, transfer_cbu, transfer_holder FROM vendors WHERE id = $1 LIMIT 1`,
      [vendor.id]
    ).catch(() => null);

    const items = Array.isArray(order.items) ? (order.items as any[]) : [];
    const total = Number(order.total) || 0;
    const estimated = Number(order.weight_estimated_total) || 0;
    const trackUrl = order.track_token
      ? `${getSiteUrl()}/seguimiento/${order.track_token}`
      : null;
    const orderLabel = order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`;

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
        vendorId: vendor.id,
        waId: order.customer_phone,
        text,
        orderId: params.id,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!r) {
      return NextResponse.json(
        { error: "El bot no está conectado (el celular está apagado o sin señal)", text },
        { status: 502 }
      );
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({ error: data.error || "No se pudo enviar", text }, { status: 502 });
    }
    return NextResponse.json({ ok: true, sent: data.sent === true, reason: data.reason || null, text });
  },
  { maxRequests: 20 }
);
