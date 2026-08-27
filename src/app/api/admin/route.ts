import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [vendors, orders, reviews, products] = await Promise.all([
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
    queryMany<Record<string, unknown>>(
      `SELECT id, name, price, available, vendor_id FROM products
       ORDER BY created_at DESC`
    ),
  ]);

  const totalProducts = products.length;
  const totalRevenue =
    orders
      .filter((o: any) => o.status !== "cancelled")
      .reduce((s: number, o: any) => s + Number(o.total), 0) || 0;
  const avgRating =
    reviews.length > 0
      ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length
      : 0;

  return NextResponse.json({
    vendors,
    orders,
    reviews,
    stats: {
      totalVendors: vendors.length,
      totalOrders: orders.length,
      totalProducts,
      totalReviews: reviews.length,
      totalRevenue,
      avgRating: Math.round(avgRating * 10) / 10,
    },
  });
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
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await query(`UPDATE vendors SET verified = $1 WHERE id = $2`, [!vendor.verified, vendorId]);
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle_admin") {
    const vendor = await queryOne<{ is_admin: boolean }>(
      `SELECT is_admin FROM vendors WHERE id = $1`,
      [vendorId]
    );
    if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });
    await query(`UPDATE vendors SET is_admin = $1 WHERE id = $2`, [!vendor.is_admin, vendorId]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}