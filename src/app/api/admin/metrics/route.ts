import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne } from "@/lib/db";

const num = (v: unknown) => Number(v ?? 0);

async function hasColumn(table: string, column: string): Promise<boolean> {
  try {
    const r = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS exists`,
      [table, column]
    );
    return r?.exists === true;
  } catch {
    return false;
  }
}

async function hasTable(table: string): Promise<boolean> {
  try {
    const r = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table]
    );
    return r?.exists === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    // Solo comercios activos en la app (visibles en el portal): las pruebas
    // y borradores ocultos no entran en ninguna métrica. Tolerante a
    // migración pendiente (sin `visible` → fallback a `verified`).
    const useVisible = await hasColumn("vendors", "visible");
    const activeV = useVisible ? "v.visible = true" : "v.verified = true";
    const activeW = useVisible ? "w.visible = true" : "w.verified = true";
    // Visitas: tolerante a migración pendiente (sin tabla → ceros).
    const useVisits = await hasTable("store_visits");
    const visitsJoin = useVisits
      ? `LEFT JOIN (
           SELECT vendor_id,
                  count(*) AS visits_30d,
                  count(DISTINCT device_id) AS visitors_30d
           FROM store_visits
           WHERE created_at >= now() - interval '30 days'
           GROUP BY vendor_id
         ) s ON s.vendor_id = v.id`
      : "";
    const visitsSelect = useVisits
      ? `COALESCE(s.visits_30d, 0) AS visits_30d,
         COALESCE(s.visitors_30d, 0) AS visitors_30d`
      : `0 AS visits_30d,
         0 AS visitors_30d`;

    const [perVendorRaw, perVerticalRaw, byPaymentRaw, byChannelRaw, plansAgg, plansList, totals] =
      await Promise.all([
        // OJO: pedidos, consultas y visitas se agregan en subqueries separadas.
        // Un doble LEFT JOIN (orders × quotes) inflaba todos los conteos.
        queryMany<Record<string, unknown>>(
          `SELECT v.store_name, v.vertical, v.neighborhood,
                  COALESCE(o.orders_30d, 0) AS orders_30d,
                  COALESCE(o.orders_total, 0) AS orders_total,
                  COALESCE(o.completed_total, 0) AS completed_total,
                  COALESCE(o.completed_30d, 0) AS completed_30d,
                  COALESCE(o.revenue_total, 0) AS revenue_total,
                  COALESCE(q.quotes_total, 0) AS quotes_total,
                  ${visitsSelect}
           FROM vendors v
           LEFT JOIN (
             SELECT vendor_id,
                    count(*) FILTER (WHERE is_preview = false AND created_at >= now() - interval '30 days') AS orders_30d,
                    count(*) FILTER (WHERE is_preview = false) AS orders_total,
                    count(*) FILTER (WHERE is_preview = false AND status = 'completed') AS completed_total,
                    count(*) FILTER (WHERE is_preview = false AND status = 'completed' AND created_at >= now() - interval '30 days') AS completed_30d,
                    COALESCE(sum(total) FILTER (WHERE is_preview = false AND status = 'completed'), 0) AS revenue_total
             FROM orders
             GROUP BY vendor_id
           ) o ON o.vendor_id = v.id
           LEFT JOIN (
             SELECT vendor_id, count(*) AS quotes_total
             FROM quotes
             GROUP BY vendor_id
           ) q ON q.vendor_id = v.id
           ${visitsJoin}
           WHERE ${activeV}
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
           WHERE ${activeV}
           GROUP BY v.vertical
           ORDER BY orders_total DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT o.payment_method, count(*) AS n
           FROM orders o JOIN vendors w ON w.id = o.vendor_id
           WHERE o.is_preview = false AND ${activeW}
           GROUP BY o.payment_method ORDER BY n DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT o.channel, count(*) AS n
           FROM orders o JOIN vendors w ON w.id = o.vendor_id
           WHERE o.is_preview = false AND ${activeW}
           GROUP BY o.channel ORDER BY n DESC`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT
             count(*) FILTER (WHERE plan_id IS NULL
               OR plan_id IN (SELECT id FROM plans WHERE slug = 'gratuito')) AS free_vendors,
             count(*) AS total_vendors
           FROM vendors v
           WHERE ${activeV}`
        ),
        queryMany<Record<string, unknown>>(
          // La columna es price_monthly (no existe `price`): alias para el cliente.
          `SELECT slug, name, price_monthly AS price FROM plans ORDER BY price_monthly`
        ),
        queryMany<Record<string, unknown>>(
          `SELECT
             count(*) FILTER (WHERE o.is_preview = false) AS total,
             count(*) FILTER (WHERE o.is_preview = false AND o.created_at >= now() - interval '7 days') AS last7,
             count(*) FILTER (WHERE o.is_preview = false AND o.created_at >= now() - interval '30 days') AS last30,
             count(*) FILTER (WHERE o.is_preview = false AND o.status = 'completed' AND o.created_at >= now() - interval '30 days') AS completed30
           FROM orders o JOIN vendors w ON w.id = o.vendor_id
           WHERE ${activeW}`
        ),
      ]);

    // `pg` devuelve count()/sum() como string: normalizar a Number acá para
    // que el cliente pueda formatear sin guards.
    const perVendor = (perVendorRaw as any[]).map((r) => {
      const visitors = num(r.visitors_30d);
      const completed30 = num(r.completed_30d);
      return {
        store_name: String(r.store_name ?? ""),
        vertical: String(r.vertical ?? ""),
        neighborhood: String(r.neighborhood ?? ""),
        orders_30d: num(r.orders_30d),
        orders_total: num(r.orders_total),
        completed_total: num(r.completed_total),
        completed_30d: completed30,
        revenue_total: num(r.revenue_total),
        quotes_total: num(r.quotes_total),
        visits_30d: num(r.visits_30d),
        visitors_30d: visitors,
        // % de visitantes únicos que completaron compra (30d).
        conv_rate: visitors > 0 ? Math.round((completed30 / visitors) * 1000) / 10 : 0,
      };
    });
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
    const last30 = num(t.last30);
    const completed30 = num(t.completed30);
    const whatsappOrders = byPayment.find((r) => r.payment_method === "whatsapp")?.n || 0;
    const whatsappPct = totalOrders > 0 ? Math.round((whatsappOrders / totalOrders) * 100) : 0;

    const totalRevenue = perVendor.reduce((s, r) => s + r.revenue_total, 0);
    const activeVendors30d = perVendor.filter((r) => r.orders_30d > 0).length;
    const visits30d = perVendor.reduce((s, r) => s + r.visits_30d, 0);
    const visitors30d = perVendor.reduce((s, r) => s + r.visitors_30d, 0);
    // Funnel global 30d: visitantes únicos → pedidos → compras completadas.
    const orderRate = visitors30d > 0 ? Math.round((last30 / visitors30d) * 1000) / 10 : 0;
    const funnelRate = visitors30d > 0 ? Math.round((completed30 / visitors30d) * 1000) / 10 : 0;

    return NextResponse.json({
      summary: {
        totalOrders,
        last7: num(t.last7),
        last30,
        totalRevenue: Math.round(totalRevenue),
        totalVendors,
        freeVendors,
        paidVendors,
        paidPct,
        whatsappPct,
        activeVendors30d,
        visits30d,
        visitors30d,
        orderRate,
        funnelRate,
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
