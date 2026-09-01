import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor } from "@/types/database";

export async function GET(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { vendor: resolved } = await getVendorByRequest(request);
  if (!resolved) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vendor = await queryOne<Vendor>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at FROM vendors WHERE id = $1 LIMIT 1`,
    [resolved.id]
  );
  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans);

  // Plan gratuito: sin datos, solo la invitación a suscribirse.
  if (plan.analyticsDays <= 0) {
    return NextResponse.json({
      locked: true,
      plan: { slug: plan.slug, analyticsDays: plan.analyticsDays, eligibleForPaid: plan.eligibleForPaid },
    });
  }

  const vendorId = vendor.id;
  const analyticsDays = plan.analyticsDays;
  const since = new Date(Date.now() - analyticsDays * 24 * 60 * 60 * 1000).toISOString();

  const [orders, products, reviews] = await Promise.all([
    queryMany<Record<string, any>>(
      `SELECT id, items, total, status, method, channel, customer_id, created_at, estimated_minutes FROM orders WHERE vendor_id = $1 AND created_at >= $2 ORDER BY created_at DESC`,
      [vendorId, since]
    ),
    queryMany<Record<string, any>>(
      `SELECT id, name, price, category, available, stock, stock_low_threshold FROM products WHERE vendor_id = $1`,
      [vendorId]
    ),
    queryMany<Record<string, any>>(
      `SELECT rating, comment, customer_name, created_at FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC`,
      [vendorId]
    ),
  ]);

  const activeOrders = orders.filter((o) => ["new", "confirmed", "preparing", "ready", "sent"].includes(o.status));
  const completedOrders = orders.filter((o) => o.status === "completed");
  const cancelledOrders = orders.filter((o) => o.status === "cancelled");

  const totalRevenue = completedOrders.reduce((s, o) => s + Number(o.total), 0);
  const avgOrderValue = completedOrders.length > 0 ? Math.round(totalRevenue / completedOrders.length) : 0;

  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

  // Top productos por unidades vendidas y facturación
  const productSales: Record<string, { name: string; count: number; revenue: number }> = {};
  for (const order of completedOrders) {
    for (const item of order.items || []) {
      const key = item.name;
      if (!productSales[key]) productSales[key] = { name: key, count: 0, revenue: 0 };
      productSales[key].count += item.qty;
      productSales[key].revenue += item.price * item.qty;
    }
  }
  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Pedidos por día (últimos N días)
  const now = new Date();
  const ordersByDay: Record<string, { count: number; revenue: number }> = {};
  for (let i = analyticsDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split("T")[0];
    ordersByDay[key] = { count: 0, revenue: 0 };
  }
  for (const order of completedOrders) {
    const key = order.created_at.split("T")[0];
    if (ordersByDay[key]) {
      ordersByDay[key].count++;
      ordersByDay[key].revenue += Number(order.total);
    }
  }

  // Pedidos por canal (app vs mostrador vs mesa)
  const byChannel: Record<string, number> = {};
  for (const o of orders) {
    const c = o.channel || "app";
    byChannel[c] = (byChannel[c] || 0) + 1;
  }

  // Retiro vs domicilio
  const byMethod: Record<string, number> = {};
  for (const o of completedOrders) {
    const m = o.method || "delivery";
    byMethod[m] = (byMethod[m] || 0) + 1;
  }

  // Pedidos por horario (horas pico) - avanzado
  const ordersByHour: Record<string, number> = {};
  for (const o of orders) {
    const hour = o.created_at.split("T")[1]?.slice(0, 2) || "00";
    ordersByHour[hour] = (ordersByHour[hour] || 0) + 1;
  }
  const topHours = Object.entries(ordersByHour)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour, count]) => ({ hour, count }));

  // Clientes recurrentes vs nuevos (por customer_id)
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

  // Ventas por categoría de producto (avanzado)
  const productCategory: Record<string, string> = {};
  for (const p of products) productCategory[p.name] = p.category || "Sin categoría";
  const byCategory: Record<string, { count: number; revenue: number }> = {};
  for (const order of completedOrders) {
    for (const item of order.items || []) {
      const cat = productCategory[item.name] || "Sin categoría";
      if (!byCategory[cat]) byCategory[cat] = { count: 0, revenue: 0 };
      byCategory[cat].count += item.qty;
      byCategory[cat].revenue += item.price * item.qty;
    }
  }

  const lowStock = products.filter(
    (p) => p.stock_low_threshold != null && p.stock != null && p.stock <= p.stock_low_threshold
  );

  // Panel "hoy"
  const todayKey = now.toISOString().split("T")[0];
  const todayOrders = orders.filter((o) => o.created_at.split("T")[0] === todayKey);
  const todayCompleted = todayOrders.filter((o) => o.status === "completed");
  const todayRevenue = todayCompleted.reduce((s, o) => s + Number(o.total), 0);

  return NextResponse.json({
    locked: false,
    plan: { slug: plan.slug, analyticsDays },
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
    today: {
      orders: todayOrders.length,
      revenue: todayRevenue,
      avgOrderValue: todayCompleted.length > 0 ? Math.round(todayRevenue / todayCompleted.length) : 0,
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
    topHours,
    customers: { new: newCustomers, recurring: recurringCustomers, withAccount: withCustomer },
    byCategory: Object.entries(byCategory)
      .map(([category, data]) => ({ category, ...data }))
      .sort((a, b) => b.revenue - a.revenue),
  });
}