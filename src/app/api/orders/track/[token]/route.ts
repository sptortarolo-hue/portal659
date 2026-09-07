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
              jsonb_build_object(
                'store_name', v.store_name,
                'slug', v.slug,
                'whatsapp', v.whatsapp,
                'phone', v.phone,
                'vertical', v.vertical,
                'prep_time_min', v.prep_time_min
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

    return NextResponse.json({ order: { ...order, timeline: timeline || [] } });
  },
  { maxRequests: 30 }
);