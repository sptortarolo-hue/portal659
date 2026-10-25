import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(
  async (_request: Request, context: { params: Promise<{ token: string }> }) => {
    const params = await context.params;
    const token = params.token;

    if (!token) {
      return NextResponse.json({ error: "Token requerido" }, { status: 400 });
    }

    const order = await queryOne<Record<string, unknown>>(
      `SELECT o.id,
              o.customer_name,
              o.method,
              o.items,
              o.total,
              o.status,
              o.payment_method,
              o.payment_status,
              o.pickup_number,
              o.estimated_minutes,
              o.created_at,
              -- Pesables (migrate-weight-confirm.sql, tolerante sin aplicar).
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_confirmed_at')
                THEN o.weight_confirmed_at ELSE NULL END AS weight_confirmed_at,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_approved_at')
                THEN o.weight_approved_at ELSE NULL END AS weight_approved_at,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_estimated_total')
                THEN o.weight_estimated_total ELSE NULL END AS weight_estimated_total,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'weight_tolerance_pct')
                THEN v.weight_tolerance_pct ELSE 20 END AS weight_tolerance_pct,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'weight_confirm_mode')
                THEN v.weight_confirm_mode ELSE 'estimado' END AS weight_confirm_mode,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'giftcard_discount')
                THEN COALESCE(o.giftcard_discount, 0) ELSE 0 END AS giftcard_discount,
              -- Turno de entrega retail (tolerante a migración sin aplicar).
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'delivery_window')
                THEN o.delivery_window ELSE NULL END AS delivery_window,
              -- "¿Con cuánto abonás?" (efectivo + delivery; tolerante a migración).
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'cash_amount')
                THEN o.cash_amount ELSE NULL END AS cash_amount,
              -- Canje de giftcard (tolerante a migración sin aplicar).
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'giftcard_discount')
                THEN COALESCE(o.giftcard_discount, 0) ELSE 0 END AS giftcard_discount,
              -- Punto vivo del repartidor (tolerante a migración sin aplicar).
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'courier_lat')
                THEN o.courier_lat ELSE NULL END AS courier_lat,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'courier_lng')
                THEN o.courier_lng ELSE NULL END AS courier_lng,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'courier_updated_at')
                THEN o.courier_updated_at ELSE NULL END AS courier_updated_at,
              jsonb_build_object(
                'store_name', v.store_name,
                'slug', v.slug,
                'whatsapp', v.whatsapp,
                'phone', v.phone,
                'vertical', v.vertical,
                'prep_time_min', v.prep_time_min,
                'lat', v.lat,
                'lng', v.lng,
                'delivery_coordinar', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'delivery_coordinar')
                  THEN v.delivery_coordinar ELSE false END
              ) AS vendors
       FROM orders o
       LEFT JOIN vendors v ON v.id = o.vendor_id
       WHERE o.track_token = $1
       LIMIT 1`,
      [token]
    );

    if (!order) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }

    const timeline = await queryMany<{ status: string; created_at: string }>(
      `SELECT status, created_at FROM order_status_log WHERE order_id = $1 ORDER BY created_at ASC`,
      [order.id as string]
    );

    // Privacidad: el punto vivo solo se expone mientras el envío va En camino.
    // En cualquier otro estado se manda null aunque la DB aún lo tenga.
    if (order.status !== "sent" || order.method !== "delivery") {
      order.courier_lat = null;
      order.courier_lng = null;
      order.courier_updated_at = null;
    }

    return NextResponse.json({ order: { ...order, timeline: timeline || [] } });
  },
  { maxRequests: 30 }
);