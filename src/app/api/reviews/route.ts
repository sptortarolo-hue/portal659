import { getUserId } from "@/lib/auth-utils";
import { query, queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendor_id");

  if (!vendorId) {
    return NextResponse.json({ error: "vendor_id requerido" }, { status: 400 });
  }

  const data = await queryMany<{ rating: number }>(
    `SELECT * FROM reviews WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [vendorId]
  );

  const avg = data && data.length > 0
    ? data.reduce((sum, r) => sum + r.rating, 0) / data.length
    : 0;

  return NextResponse.json({ reviews: data || [], avgRating: Math.round(avg * 10) / 10, count: data?.length || 0 });
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Debés estar logueado para reseñar" }, { status: 401 });
  }

  const body = await request.json();
  const { vendorId, productId, customerName, rating, comment } = body;

  if (!vendorId || !customerName || !rating || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const hasOrder = await queryOne<{ id: string }>(
    `SELECT id FROM orders WHERE customer_id = $1 AND vendor_id = $2 AND status = 'completed' LIMIT 1`,
    [userId, vendorId]
  );

  if (!hasOrder) {
    return NextResponse.json(
      { error: "Debés tener un pedido completado en este local para dejar una reseña" },
      { status: 403 }
    );
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM reviews WHERE vendor_id = $1 AND customer_id = $2 LIMIT 1`,
    [vendorId, userId]
  );

  if (existing) {
    return NextResponse.json({ error: "Ya dejaste una reseña en este local" }, { status: 409 });
  }

  await query(
    `INSERT INTO reviews (vendor_id, product_id, customer_id, customer_name, rating, comment)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [vendorId, productId || null, userId, customerName, rating, comment || null]
  );

  return NextResponse.json({ ok: true });
}