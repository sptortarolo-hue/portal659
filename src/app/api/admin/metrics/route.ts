import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [perVendor, perVertical, byPayment, byChannel, plansAgg, plansList, totals] =
    await Promise.all([
      queryMany<Record<string, unknown>>(
        `SELECT v.store_name, v.vertical, v.neighborhood,
                count(o.id) FILTER (WHERE o.created_at >= now() - interval '30 days') AS orders_30d,
                count(o.id) AS orders_total,
                count(o.id) FILTER (WHERE o.status = 'completed') AS completed_total,
                COALESCE(sum(o.total) FILTER (WHERE o.status = 'completed'), 0) AS revenue_total,
                count(q.id) AS quotes_total
         FROM vendors v
         LEFT JOIN orders o ON o.vendor_id = v.id
         LEFT JOIN quotes q ON q.vendor_id = v.id
         GROUP BY v.id
         ORDER BY orders_total DESC, revenue_total DESC`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT v.vertical,
                count(DISTINCT v.id) AS vendors,
                count(o.id) AS orders_total,
                count(o.id) FILTER (WHERE o.status = 'completed') AS completed_total,
                COALESCE(sum(o.total) FILTER (WHERE o.status = 'completed'), 0) AS revenue_total
         FROM vendors v
         LEFT JOIN orders o ON o.vendor_id = v.id
         GROUP BY v.vertical
         ORDER BY orders_total DESC`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT payment_method, count(*) AS n FROM orders GROUP BY payment_method ORDER BY n DESC`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT channel, count(*) AS n FROM orders GROUP BY channel ORDER BY n DESC`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT
           count(*) FILTER (WHERE plan_id IS NULL
             OR plan_id IN (SELECT id FROM plans WHERE slug = 'gratuito')) AS free_vendors,
           count(*) FILTER (WHERE plan_id IN (SELECT id FROM plans WHERE slug IN ('pedidos','gestion'))) AS paid_vendors,
           count(*) AS total_vendors
         FROM vendors`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT slug, name, price FROM plans ORDER BY price`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT
           count(*) AS total,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last7,
           count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS last30
         FROM orders`
      ),
    ]);

  const paidRows = (plansAgg[0] || {}) as Record<string, unknown>;
  const totalVendors = Number(paidRows.total_vendors || 0);
  const paidVendors = Number(paidRows.paid_vendors || 0);
  const freeVendors = Number(paidRows.free_vendors || 0);
  const paidPct = totalVendors > 0 ? Math.round((paidVendors / totalVendors) * 100) : 0;

  const t = (totals[0] || {}) as Record<string, unknown>;
  const totalOrders = Number(t.total || 0);
  const whatsappOrders = (byPayment as any[]).find((r) => r.payment_method === "whatsapp")?.n || 0;
  const whatsappPct = totalOrders > 0 ? Math.round((Number(whatsappOrders) / totalOrders) * 100) : 0;

  const totalRevenue = (perVendor as any[]).reduce((s: number, r: any) => s + Number(r.revenue_total || 0), 0);
  const activeVendors30d = (perVendor as any[]).filter((r: any) => Number(r.orders_30d || 0) > 0).length;

  return NextResponse.json({
    summary: {
      totalOrders,
      last7: Number(t.last7 || 0),
      last30: Number(t.last30 || 0),
      totalRevenue: Math.round(totalRevenue),
      totalVendors,
      freeVendors,
      paidVendors,
      paidPct,
      whatsappPct,
      activeVendors30d,
    },
    perVendor,
    perVertical,
    byPayment,
    byChannel,
    plans: plansList,
  });
}