import { getAuthSupabase, getUserId } from "@/lib/auth-utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = getAuthSupabase(request);
  if (!supabase) return NextResponse.json({ error: "Error de conexión" }, { status: 503 });

  const userId = await getUserId(supabase);
  if (!userId) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: vendor } = await supabase
    .from("vendors")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (!vendor) return NextResponse.json({ error: "No tenés un local" }, { status: 403 });

  const vendorId = vendor.id;

  const [ordersRes, productsRes, reviewsRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, items, total, status, created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false }),
    supabase
      .from("products")
      .select("id, name, price, available, stock, stock_low_threshold")
      .eq("vendor_id", vendorId),
    supabase
      .from("reviews")
      .select("rating, comment, customer_name, created_at")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false }),
  ]);

  const orders = ordersRes.data || [];
  const products = productsRes.data || [];
  const reviews = reviewsRes.data || [];

  const activeOrders = orders.filter((o) => o.status === "new" || o.status === "confirmed" || o.status === "preparing" || o.status === "ready" || o.status === "sent");
  const completedOrders = orders.filter((o) => o.status === "completed");
  const cancelledOrders = orders.filter((o) => o.status === "cancelled");

  const totalRevenue = completedOrders.reduce((s, o) => s + Number(o.total), 0);
  const avgOrderValue = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;

  const avgRating = reviews.length > 0
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  // Product sales count
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

  // Orders by day (last 30 days)
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

  // Low stock products
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
