import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

/**
 * POST /api/vendor/orders/[id]/send-payment-data — el comercio aprieta el botón
 * "Enviar datos de pago por WA" en el pedido (transferencia pendiente) y el bot
 * manda el alias/CBU/titular + monto + link de seguimiento por WhatsApp. El
 * comprobante del cliente vuelve por el mismo chat → transfer_proof_url →
 * visible en el panel. Manual a propósito: el comercio decide cuándo cobrar.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const order = await queryOne<{
    id: string;
    customer_phone: string | null;
    total: number;
    payment_method: string;
    payment_status: string;
    pickup_number: number | null;
    track_token: string | null;
    is_preview: boolean | null;
  }>(
    `SELECT id, customer_phone, total, payment_method, payment_status, pickup_number, track_token, is_preview
     FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (order.payment_method !== "transferencia") {
    return NextResponse.json({ error: "El pedido no es por transferencia" }, { status: 400 });
  }
  if (order.is_preview === true) {
    return NextResponse.json({ error: "Pedido de prueba" }, { status: 400 });
  }
  if (!order.customer_phone || order.customer_phone.startsWith("lid:")) {
    return NextResponse.json({ error: "El pedido no tiene teléfono del cliente" }, { status: 400 });
  }
  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "El pedido ya está pagado" }, { status: 400 });
  }

  const vendorRow = await queryOne<{ transfer_alias: string | null; transfer_cbu: string | null; transfer_holder: string | null }>(
    `SELECT transfer_alias, transfer_cbu, transfer_holder FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );

  const nro = order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`;
  const lines = [`✅ ¡Tu pedido ${nro} fue aceptado!`, "", "Para el pago (transferencia):"];
  if (vendorRow?.transfer_alias) lines.push(`Alias: ${vendorRow.transfer_alias}`);
  if (vendorRow?.transfer_cbu) lines.push(`CBU: ${vendorRow.transfer_cbu}`);
  if (vendorRow?.transfer_holder) lines.push(`Titular: ${vendorRow.transfer_holder}`);
  lines.push(`Monto: $${Number(order.total).toLocaleString("es-AR")}`);
  lines.push("", "Mandanos la foto o el PDF del comprobante por acá y lo verificamos enseguida. 🙏");
  if (order.track_token) {
    lines.push(`📦 Seguí tu pedido acá: ${getSiteUrl()}/seguimiento/${order.track_token}`);
  }

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
      text: lines.join("\n"),
      orderId: params.id,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return NextResponse.json({ error: "El bot no está conectado (el celular está apagado o sin señal)" }, { status: 502 });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: data.error || "No se pudo enviar" }, { status: 502 });
  return NextResponse.json({ ok: true, sent: data.sent === true, reason: data.reason || null });
}
