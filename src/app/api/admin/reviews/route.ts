import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, query } from "@/lib/db";

export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const rating = url.searchParams.get("rating");
  const vendorId = url.searchParams.get("vendor_id");
  const search = url.searchParams.get("search");

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (rating) {
    params.push(parseInt(rating));
    conditions.push(`r.rating = $${params.length}`);
  }
  if (vendorId) {
    params.push(vendorId);
    conditions.push(`r.vendor_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(r.customer_name ILIKE $${params.length} OR r.comment ILIKE $${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const reviews = await queryMany<Record<string, unknown>>(
    `SELECT r.*, v.store_name, v.slug
     FROM reviews r
     LEFT JOIN vendors v ON v.id = r.vendor_id
     ${whereClause}
     ORDER BY r.created_at DESC`,
    params
  );
  return NextResponse.json({ reviews });
}

export async function DELETE(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { reviewId } = body;

  if (!reviewId) {
    return NextResponse.json({ error: "reviewId es requerido" }, { status: 400 });
  }

  await query(`DELETE FROM reviews WHERE id = $1`, [reviewId]);
  return NextResponse.json({ ok: true });
}