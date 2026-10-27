import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryMany } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

/**
 * GET /api/wa/portal-orders?phone= — últimos pedidos (no cancelados) del
 * teléfono en las últimas 48h, de TODAS las tiendas visibles. Lo usa el bot
 * del portal para responder "¿cómo va mi pedido?" / "¿dónde está?".
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const phoneDigits = (url.searchParams.get("phone") || "").replace(/\D/g, "");
  if (phoneDigits.length < 6) {
    return NextResponse.json({ error: "phone requerido" }, { status: 400 });
  }

  const orders = await queryMany<{
    id: string;
    pickup_number: number | null;
    status: string;
    track_token: string | null;
    customer_name: string;
    store_name: string;
    store_slug: string | null;
    store_id: string;
    total: number;
    method: string | null;
    payment_method: string | null;
    items: any;
    created_at: string;
  }>(
    `SELECT o.id, o.pickup_number, o.status, o.track_token, o.customer_name, o.total, o.method, o.payment_method, o.items, o.created_at,
            v.id AS store_id, v.store_name, v.slug AS store_slug
     FROM orders o
     JOIN vendors v ON v.id = o.vendor_id
     WHERE regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g') LIKE '%' || $1
       AND o.status <> 'cancelled'
       AND COALESCE(o.is_preview, false) = false
       AND o.created_at > now() - interval '48 hours'
       AND COALESCE(v.visible, true) = true
     ORDER BY o.created_at DESC
     LIMIT 5`,
    [phoneDigits.slice(-10)]
  ).catch(() => []);

  if (!orders || orders.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  const siteUrl = getSiteUrl();
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      pickupNumber: o.pickup_number,
      status: o.status,
      storeName: o.store_name,
      storeSlug: o.store_slug,
      storeId: o.store_id,
      total: Number(o.total),
      method: o.method || "pickup",
      paymentMethod: o.payment_method || "whatsapp",
      items: Array.isArray(o.items) ? o.items : [],
      trackUrl: o.track_token ? `${siteUrl}/seguimiento/${o.track_token}` : null,
      createdAt: o.created_at,
    })),
  });
}
