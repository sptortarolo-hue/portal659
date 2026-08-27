import { getAuthUser } from "@/lib/auth";
import { queryMany, queryOne } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor } from "@/types/database";

export async function GET(request: Request) {
  const authUser = await getAuthUser(request);
  if (!authUser) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const vendor = await queryOne<Vendor>(
    `SELECT id, vertical, plan_id, plan_status, plan_expires_at, trial_ends_at FROM vendors WHERE user_id = $1 LIMIT 1`,
    [authUser.id]
  );
  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans);

  if (plan.analyticsDays <= 0) {
    return NextResponse.json(
      { error: "Las estadísticas forman parte de los planes Pedidos y Gestión integral." },
      { status: 403 }
    );
  }

  const vendorId = vendor.id;
  const since = new Date(Date.now() - plan.analyticsDays * 24 * 60 * 60 * 1000).toISOString();

  const [orders, products, reviews] = await Promise.all([
    queryMany<Record<string, any>>(
      `SELECT id, items, total, status, created_at FROM orders WHERE vendor_id = $1 AND created_at >= $2 ORDER BY created_at DESC`,
      [vendorId, since]
    ),
    queryMany<Record<string, any>>(
      `SELECT id, name, price, available, stock, stock_low_threshold FROM products WHERE vendor_id = $1`,
      [vendorId]
    ),
    queryMany<Record<string, any>>(
      `SELECT rating, comment, customer_name, created_at FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC`,
      [vendorId]
    ),
  ]);

  const activeOrders = orders.filter((o) => o.status === "new" || o.status === "confirmed" || o.status === "preparing" || o.status === "ready" || o.status === "sent");
  const completedOrders = orders.filter((o) => o.status === "completed");
  const cancelledOrders = orders.filter((o) => o.status === "cancelled");

  const totalRevenue = completedOrders.reduce((s, o) => s + Number(o.total), 0);
  const avgOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;

  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

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

  const now = new Date();
  const days30Ago = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ordersByDay: Record<string, { count: number; revenue: number }> = {};
  for (let d = new Date(days30Ago); d <= now; d.setDate(d.getDate() + 1)) {
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

  const lowStock = products.filter(
    (p) => p.stock_low_threshold != null && p.stock != null && p.stock <= p.stock_low_threshold
  );

  return NextResponse.json({
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
      avgOrderValue: Math.round(avgOrderValue),
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
  });
}