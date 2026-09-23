import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Error al verificar permisos" }, { status: 500 });
  }

  try {
    const [vendors, orders, reviews, products, stats] = await Promise.all([
    queryMany(
      `SELECT * FROM vendors ORDER BY created_at DESC`
    ),
    queryMany<Record<string, unknown>>(
      `SELECT o.*, v.store_name FROM orders o
       LEFT JOIN vendors v ON v.id = o.vendor_id
       ORDER BY o.created_at DESC LIMIT 100`
    ),
    queryMany<Record<string, unknown>>(
      `SELECT r.*, v.store_name FROM reviews r
       LEFT JOIN vendors v ON v.id = r.vendor_id
       ORDER BY r.created_at DESC LIMIT 50`
    ),
    // Para listados podemos dejarlo en una cantidad razonable.
    queryMany<Record<string, unknown>>(
      `SELECT id, name, price, available, vendor_id FROM products
       ORDER BY created_at DESC LIMIT 500`
    ),
    // Agregados: totales reales desde SQL, no desde el subset de arriba.
    queryOne<{
      total_orders: string;
      total_products: string;
      total_reviews: string;
      total_revenue: string | null;
      avg_rating: string | null;
    }>(
      `SELECT
         (SELECT COUNT(*)::bigint FROM orders WHERE is_preview = false) AS total_orders,
         (SELECT COUNT(*)::bigint FROM products)     AS total_products,
         (SELECT COUNT(*)::bigint FROM reviews)      AS total_reviews,
         (SELECT COALESCE(SUM(total)::numeric, 0)
            FROM orders WHERE status = 'completed' AND is_preview = false) AS total_revenue,
         (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews) AS avg_rating`
    ),
  ]);

  return NextResponse.json({
    vendors,
    orders,
    reviews,
    stats: {
      totalVendors: vendors.length,
      totalOrders: Number(stats?.total_orders ?? 0),
      totalProducts: Number(stats?.total_products ?? 0),
      totalReviews: Number(stats?.total_reviews ?? 0),
      totalRevenue: Number(stats?.total_revenue ?? 0),     // solo pedidos entregados
      avgRating: Number(stats?.total_revenue ?? 0) && Number(stats?.avg_rating ?? 0),
    },
  });
  } catch (e) {
    console.error("[api/admin] error:", e);
    return NextResponse.json({ error: "No se pudieron cargar los datos del panel" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { vendorId, action } = body;

  if (!vendorId || !action) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  if (action === "toggle_verified") {
    const vendor = await queryOne<{ verified: boolean }>(
      `SELECT verified FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
    await query(`UPDATE vendors SET verified = $1 WHERE id = $2`, [!vendor.verified, vendorId]);
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_admin") {
    const vendor = await queryOne<{ is_admin: boolean; user_id: string | null }>(
      `SELECT is_admin, user_id FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
    const next = !vendor.is_admin;
    await query(`UPDATE vendors SET is_admin = $1 WHERE id = $2`, [next, vendorId]);
    // El permiso real está en profiles.is_admin: sincronizar.
    if (vendor.user_id) {
      await query(`UPDATE profiles SET is_admin = $1 WHERE id = $2`, [next, vendor.user_id]);
    }
    return NextResponse.json({ ok: true, is_admin: next });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}