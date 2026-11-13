import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryOne } from "@/lib/db";

/**
 * GET /api/wa/customer?vendorId=&phone= — memoria del cliente para el bot.
 * Devuelve el ÚLTIMO pedido no cancelado del teléfono (ventana amplia, 90 días)
 * con nombre, dirección, método, pago y los ítems tal como se pidieron, para
 * que el bot no tenga que volver a preguntar lo que ya sabe y pueda ofrecer
 * "¿lo de siempre?".
 * Exige WA_BOT_SECRET. Read-only, no crea ni modifica nada.
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || "";
  const phoneDigits = (url.searchParams.get("phone") || "").replace(/\D/g, "");
  if (!vendorId || phoneDigits.length < 6) {
    return NextResponse.json({ error: "vendorId y phone requeridos" }, { status: 400 });
  }

  type Row = {
    id: string;
    customer_name: string | null;
    customer_address: string | null;
    method: string | null;
    payment_method: string | null;
    items: unknown;
    total: number | null;
    status: string | null;
    track_token: string | null;
    created_at: string;
  };

  const order = await queryOne<Row>(
    `SELECT id, customer_name, customer_address, method, payment_method,
            items, total, status, track_token, created_at
     FROM orders
     WHERE vendor_id = $1
       AND regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $2
       AND status <> 'cancelled'
       AND is_preview IS NOT TRUE
       AND created_at > now() - interval '90 days'
     ORDER BY created_at DESC
     LIMIT 1`,
    [vendorId, phoneDigits.slice(-10)]
  ).catch(() => null);

  if (!order) {
    return NextResponse.json({ ok: true, found: false });
  }

  const items = Array.isArray(order.items)
    ? order.items
        .filter((it: any) => it && (it.product_id || it.offerId))
        .map((it: any) => ({
          offerId: it.product_id || it.offerId,
          variantId: it.variant_id || it.variantId || null,
          name: it.name,
          qty: Math.max(1, Number(it.qty) || 1),
          unit: it.unit || null,
          weightKg: it.weightKg != null ? Number(it.weightKg) : null,
          modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
        }))
    : [];

  return NextResponse.json({
    ok: true,
    found: true,
    customerName: order.customer_name,
    customerAddress: order.customer_address,
    method: order.method,
    paymentMethod: order.payment_method,
    total: order.total != null ? Number(order.total) : null,
    status: order.status,
    trackUrl: order.track_token ? `/seguimiento/${order.track_token}` : null,
    orderId: order.id,
    items,
  });
}