import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor } from "@/types/database";

const TZ_AR = "America/Argentina/Buenos_Aires";

/** Revenue de un ítem (pack-aware: con pack, price = paquete y qty = unidades). */
function itemRevenue(item: { price: number; qty: number; pack_size?: number | null }): number {
  const pack = Number(item.pack_size);
  if (pack >= 2) return item.price * (item.qty / pack);
  return item.price * item.qty;
}

/** Día civil en horario argentino. node-pg devuelve Date (no string) → normalizar. */
function dayKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-CA", { timeZone: TZ_AR }); // "YYYY-MM-DD"
}

/** Hora 0-23 en horario argentino. */
function hourKey(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ_AR });
}

export async function GET(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { vendor: resolved } = await getVendorByRequest(request);
  if (!resolved) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vendor = await queryOne<Vendor>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, visible FROM vendors WHERE id = $1 LIMIT 1`,
    [resolved.id]
  );
  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans);
  const analyticsDays = plan.analyticsDays;

  const vendorId = vendor.id;

  // Siempre traemos pedidos recientes (para el panel "Hoy" y comparativo), y el
  // histórico para los planes pagos. Cap a 1 año: con Gestión analyticsDays es
  // 99999 ("ilimitado") y sin tope el loop de días abajo era O(100k) de
  // Intl.toLocaleDateString — llevaba varios segundos de CPU por request y el
  // cliente mostraba "tildado".
  const lookback = Math.min(Math.max(analyticsDays, 30), 366); // 30-366 días
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000).toISOString();

  const [orders, products, reviews] = await Promise.all([
    queryMany<Record<string, any>>(
      `SELECT id, items, total, status, method, channel, customer_id, created_at, estimated_minutes FROM orders WHERE vendor_id = $1 AND is_preview = false AND created_at >= $2 ORDER BY created_at DESC`,
      [vendorId, since]
    ),
    queryMany<Record<string, any>>(
      `SELECT id, name, price, category, available, stock, stock_low_threshold FROM products WHERE vendor_id = $1`,
      [vendorId]
    ),
    queryMany<Record<string, any>>(
      `SELECT rating, comment, customer_name, created_at FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [vendorId]
    ),
  ]);

  const completedOrders = orders.filter((o) => o.status === "completed");
  const totalRevenue = completedOrders.reduce((s, o) => s + Number(o.total), 0);
  const avgOrderValue = completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0;
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  // Panel "Hoy"
  const now = new Date();
  const todayKey = dayKey(now);
  const todayOrders = orders.filter((o) => dayKey(o.created_at) === todayKey);
  const todayCompleted = todayOrders.filter((o) => o.status === "completed");
  const todayRevenue = todayCompleted.reduce((s, o) => s + Number(o.total), 0);
  const today = {
    orders: todayOrders.length,
    revenue: todayRevenue,
    avgOrderValue: todayCompleted.length > 0 ? Math.round(todayRevenue / todayCompleted.length) : 0,
  };

  // Comparativo vs semana anterior (solo si hay plan pago)
  const weekAgoStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoEnd = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const thisWeek = orders.filter((o) => o.status === "completed" && new Date(o.created_at) >= weekAgoStart);
  const prevWeek = orders.filter((o) => o.status === "completed" && new Date(o.created_at) >= weekAgoEnd && new Date(o.created_at) < weekAgoStart);
  const thisWeekRevenue = thisWeek.reduce((s, o) => s + Number(o.total), 0);
  const prevWeekRevenue = prevWeek.reduce((s, o) => s + Number(o.total), 0);
  const revenueDelta = prevWeekRevenue > 0 ? Math.round(((thisWeekRevenue - prevWeekRevenue) / prevWeekRevenue) * 100) : null;
  const ordersDelta = prevWeek.length > 0 ? Math.round(((thisWeek.length - prevWeek.length) / prevWeek.length) * 100) : null;

  // Insight: día pico de la semana (últimos 7 días)
  const dayCounts: Record<string, number> = {};
  for (const o of orders) {
    if (new Date(o.created_at) < weekAgoStart) continue;
    const dow = new Date(o.created_at).getDay();
    dayCounts[dow] = (dayCounts[dow] || 0) + 1;
  }
  const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  let peakDay: string | null = null;
  let peakCount = 0;
  for (const [dow, c] of Object.entries(dayCounts)) {
    if (c > peakCount) {
      peakCount = c;
      peakDay = DAY_NAMES[Number(dow)];
    }
  }

  // Insight: producto más vendido
  const productSales: Record<string, { name: string; count: number; revenue: number }> = {};
  for (const order of completedOrders) {
    for (const item of order.items || []) {
      const key = item.name;
      if (!productSales[key]) productSales[key] = { name: key, count: 0, revenue: 0 };
      productSales[key].count += item.qty;
      productSales[key].revenue += itemRevenue(item);
    }
  }
  const topProduct = Object.values(productSales).sort((a, b) => b.revenue - a.revenue)[0] || null;

  const insights: string[] = [];
  if (revenueDelta != null) {
    insights.push(
      revenueDelta >= 0
        ? `Ventas de esta semana ${revenueDelta}% vs la anterior.`
        : `Ventas de esta semana cayeron ${Math.abs(revenueDelta)}% vs la anterior.`
    );
  }
  if (peakDay && peakCount > 0) insights.push(`${peakDay} es tu día con más pedidos.`);
  if (topProduct) insights.push(`Tu producto más vendido es ${topProduct.name} (${topProduct.count} un.).`);

  // Solo computar el detalle histórico completo para planes pagos
  const isPaid = analyticsDays > 0;

  const responseBase: Record<string, any> = {
    plan: { slug: plan.slug, analyticsDays },
    today,
    comparison: { revenueDelta, ordersDelta },
  };

  if (!isPaid) {
    // Gratuito: solo el panel "Hoy" (+ insights livianos de ventas).
    return NextResponse.json({ ...responseBase, insights });
  }

  const activeOrders = orders.filter((o) => ["new", "preparing", "ready", "sent"].includes(o.status));
  const cancelledOrders = orders.filter((o) => o.status === "cancelled");

  // Pedidos por día (cap: el loop nunca recorre más de 366 días aunque
  // plan Gestion declare analytics_days=99999 "ilimitado")
  const daysToShow = Math.min(Math.max(analyticsDays, 0), 366);
  const ordersByDay: Record<string, { count: number; revenue: number }> = {};
  for (let i = daysToShow - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = dayKey(d);
    ordersByDay[key] = { count: 0, revenue: 0 };
  }
  for (const order of completedOrders) {
    const key = dayKey(order.created_at);
    if (ordersByDay[key]) {
      ordersByDay[key].count++;
      ordersByDay[key].revenue += Number(order.total);
    }
  }

  const byChannel: Record<string, number> = {};
  for (const o of orders) {
    const c = o.channel || "app";
    byChannel[c] = (byChannel[c] || 0) + 1;
  }

  const byMethod: Record<string, number> = {};
  for (const o of completedOrders) {
    const m = o.method || "delivery";
    byMethod[m] = (byMethod[m] || 0) + 1;
  }

  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const lowStock = products.filter(
    (p) => p.stock_low_threshold != null && p.stock != null && p.stock <= p.stock_low_threshold
  );

  // ==== Avanzado: solo Gestión ====
  const isGest = analyticsDays >= 99999;
  const advanced: Record<string, any> = {};

  if (isGest) {
    // Horas pico
    const ordersByHour: Record<string, number> = {};
    for (const o of orders) {
      const hour = hourKey(o.created_at);
      ordersByHour[hour] = (ordersByHour[hour] || 0) + 1;
    }
    advanced.topHours = Object.entries(ordersByHour)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour, count]) => ({ hour, count }));

    // Clientes recurrentes vs nuevos
    const customerCounts: Record<string, number> = {};
    let withCustomer = 0;
    for (const o of completedOrders) {
      if (o.customer_id) {
        withCustomer++;
        customerCounts[o.customer_id] = (customerCounts[o.customer_id] || 0) + 1;
      }
    }
    const recurringCustomers = Object.values(customerCounts).filter((c) => c > 1).length;
    const newCustomers = Object.keys(customerCounts).length - recurringCustomers;
    advanced.customers = { new: newCustomers, recurring: recurringCustomers, withAccount: withCustomer };

    // Ventas por categoría
    const productCategory: Record<string, string> = {};
    for (const p of products) productCategory[p.name] = p.category || "Sin categoría";
    const byCategory: Record<string, { count: number; revenue: number }> = {};
    for (const order of completedOrders) {
      for (const item of order.items || []) {
        const cat = productCategory[item.name] || "Sin categoría";
        if (!byCategory[cat]) byCategory[cat] = { count: 0, revenue: 0 };
        byCategory[cat].count += item.qty;
        byCategory[cat].revenue += itemRevenue(item);
      }
    }
    advanced.byCategory = Object.entries(byCategory)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  return NextResponse.json({
    ...responseBase,
    summary: {
      totalOrders: orders.length,
      activeOrders: activeOrders.length,
      newOrders: orders.filter((o) => o.status === "new").length,
      preparingOrders: orders.filter((o) => o.status === "preparing").length,
      readyOrders: orders.filter((o) => o.status === "ready").length,
      sentOrders: orders.filter((o) => o.status === "sent").length,
      completedOrders: completedOrders.length,
      cancelledOrders: cancelledOrders.length,
      totalRevenue,
      avgOrderValue,
      totalProducts: products.length,
      availableProducts: products.filter((p) => p.available).length,
      totalReviews: reviews.length,
      avgRating: Math.round(avgRating * 10) / 10,
    },
    topProducts,
    ordersByDay: Object.entries(ordersByDay).map(([date, data]) => ({ date, ...data })),
    recentReviews: reviews.slice(0, 5),
    lowStock,
    activeOrders: activeOrders.map((o) => ({
      id: o.id,
      items: o.items,
      total: o.total,
      status: o.status,
      created_at: o.created_at,
    })),
    byChannel,
    byMethod,
    insights,
    ...advanced,
  });
}