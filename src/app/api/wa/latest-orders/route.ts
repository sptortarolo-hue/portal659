import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

/**
 * GET /api/wa/latest-orders?vendorId=&phone= — último pedido (no cancelado) del
 * teléfono en las últimas 48h. Lo usa el cerebro del bot para detectar cuando el
 * cliente "manda el pedido armado" por el chat: tomarlo como ok y devolver el
 * contexto real (número + link de seguimiento), sin armar el pedido de nuevo.
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

  const order = await queryOne<{
    id: string;
    pickup_number: number | null;
    status: string;
    track_token: string | null;
    customer_name: string;
  }>(
    `SELECT id, pickup_number, status, track_token, customer_name
     FROM orders
     WHERE vendor_id = $1
       AND regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $2
       AND status <> 'cancelled'
       AND is_preview IS NOT TRUE
       AND created_at > now() - interval '48 hours'
     ORDER BY created_at DESC
     LIMIT 1`,
    [vendorId, phoneDigits.slice(-10)]
  ).catch(() => null);

  if (!order) return NextResponse.json({ error: "Sin pedido reciente" }, { status: 404 });
  return NextResponse.json({
    pickupNumber: order.pickup_number,
    status: order.status,
    customerName: order.customer_name,
    trackUrl: order.track_token ? `${getSiteUrl()}/seguimiento/${order.track_token}` : null,
  });
}
