import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany } from "@/lib/db";

const num = (v: unknown) => Number(v ?? 0);

export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const [perVendorRaw, perVerticalRaw, byPaymentRaw, byChannelRaw, plansAgg, plansList, totals] =
      await Promise.all([
        // OJO: pedidos y consultas se agregan en subqueries separadas. Un doble
        // LEFT JOIN (orders × quotes) inflaba todos los conteos (fan-out).
        queryMany<Record<string, unknown>>(
          `SELECT v.store_name, v.vertical, v.neighborhood,
                  COALESCE(o.orders_30d, 0) AS orders_30d,
                  COALESCE(o.orders_total, 0) AS orders_total,
                  COALESCE(o.completed_total, 0) AS completed_total,
                  COALESCE(o.revenue_total, 0) AS revenue_total,
                  COALESCE(q.quotes_total, 0) AS quotes_total
           FROM vendors v
           LEFT JOIN (
             SELECT vendor_id,
                    count(*) FILTER (WHERE is_preview = false AND created_at >= now() - interval '30 days') AS orders_30d,
                    count(*) FILTER (WHERE is_preview = false) AS orders_total,
                    count(*) FILTER (WHERE is_preview = false AND status = 'completed') AS completed_total,
                    COALESCE(sum(total) FILTER (WHERE is_preview = false AND status = 'completed'), 0) AS revenue_total
             FROM orders
             GROUP BY vendor_id
           ) o ON o.vendor_id = v.id
           LEFT JOIN (
             SELECT vendor_id, count(*) AS quotes_total
             FROM quotes
             GROUP BY vendor_id
           ) q ON q.vendor_id = v.id
           ORDER BY orders_total DESC, revenue_total DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT v.vertical,
                  count(DISTINCT v.id) AS vendors,
                  count(o.id) FILTER (WHERE o.is_preview = false) AS orders_total,
                  count(o.id) FILTER (WHERE o.status = 'completed' AND o.is_preview = false) AS completed_total,
                  COALESCE(sum(o.total) FILTER (WHERE o.status = 'completed' AND o.is_preview = false), 0) AS revenue_total
           FROM vendors v
           LEFT JOIN orders o ON o.vendor_id = v.id
           GROUP BY v.vertical
           ORDER BY orders_total DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT payment_method, count(*) AS n FROM orders WHERE is_preview = false GROUP BY payment_method ORDER BY n DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT channel, count(*) AS n FROM orders WHERE is_preview = false GROUP BY channel ORDER BY n DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT
             count(*) FILTER (WHERE plan_id IS NULL
               OR plan_id IN (SELECT id FROM plans WHERE slug = 'gratuito')) AS free_vendors,
             count(*) AS total_vendors
           FROM vendors`
        ),
        queryMany<Record<string, unknown>>(
          // La columna es price_monthly (no existe `price`): alias para el cliente.
          `SELECT slug, name, price_monthly AS price FROM plans ORDER BY price_monthly`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT
             count(*) FILTER (WHERE is_preview = false) AS total,
             count(*) FILTER (WHERE is_preview = false AND created_at >= now() - interval '7 days') AS last7,
             count(*) FILTER (WHERE is_preview = false AND created_at >= now() - interval '30 days') AS last30
           FROM orders`
        ),
      ]);

    // `pg` devuelve count()/sum() como string: normalizar a Number acá para
    // que el cliente pueda formatear sin guards.
    const perVendor = (perVendorRaw as any[]).map((r) => ({
      store_name: String(r.store_name ?? ""),
      vertical: String(r.vertical ?? ""),
      neighborhood: String(r.neighborhood ?? ""),
      orders_30d: num(r.orders_30d),
      orders_total: num(r.orders_total),
      completed_total: num(r.completed_total),
      revenue_total: num(r.revenue_total),
      quotes_total: num(r.quotes_total),
    }));
    const perVertical = (perVerticalRaw as any[]).map((r) => ({
      vertical: String(r.vertical ?? ""),
      vendors: num(r.vendors),
      orders_total: num(r.orders_total),
      completed_total: num(r.completed_total),
      revenue_total: num(r.revenue_total),
    }));
    const byPayment = (byPaymentRaw as any[]).map((r) => ({
      payment_method: r.payment_method == null ? null : String(r.payment_method),
      n: num(r.n),
    }));
    const byChannel = (byChannelRaw as any[]).map((r) => ({
      channel: String(r.channel ?? ""),
      n: num(r.n),
    }));

    const paidRows = (plansAgg[0] || {}) as Record<string, unknown>;
    const totalVendors = num(paidRows.total_vendors);
    const freeVendors = num(paidRows.free_vendors);
    // paid = total − free: robusto a futuros slugs (oficios, etc.).
    const paidVendors = Math.max(0, totalVendors - freeVendors);
    const paidPct = totalVendors > 0 ? Math.round((paidVendors / totalVendors) * 100) : 0;

    const t = (totals[0] || {}) as Record<string, unknown>;
    const totalOrders = num(t.total);
    const whatsappOrders = byPayment.find((r) => r.payment_method === "whatsapp")?.n || 0;
    const whatsappPct = totalOrders > 0 ? Math.round((whatsappOrders / totalOrders) * 100) : 0;

    const totalRevenue = perVendor.reduce((s, r) => s + r.revenue_total, 0);
    const activeVendors30d = perVendor.filter((r) => r.orders_30d > 0).length;

    return NextResponse.json({
      summary: {
        totalOrders,
        last7: num(t.last7),
        last30: num(t.last30),
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
  } catch (e) {
    console.error("[api/admin/metrics] error:", e);
    return NextResponse.json({ error: "No se pudieron cargar las métricas" }, { status: 500 });
  }
}
