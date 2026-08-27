import { getUserId } from "@/lib/auth-utils";
import { queryMany, queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ favorites: [] });

  const favorites = await queryMany<Record<string, unknown>>(
    `SELECT f.vendor_id, json_build_object('id', v.id, 'store_name', v.store_name, 'slug', v.slug, 'logo_url', v.logo_url, 'vertical', v.vertical, 'neighborhood', v.neighborhood) AS vendors
     FROM favorites f
     JOIN vendors v ON v.id = f.vendor_id
     WHERE f.user_id = $1
     ORDER BY f.created_at DESC`,
    [userId]
  );

  return NextResponse.json({ favorites });
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Debés estar logueado" }, { status: 401 });

  const body = await request.json();
  const { vendorId } = body;
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM favorites WHERE user_id = $1 AND vendor_id = $2 LIMIT 1`,
    [userId, vendorId]
  );

  if (existing) {
    await query(`DELETE FROM favorites WHERE id = $1`, [existing.id]);
    return NextResponse.json({ ok: true, favorited: false });
  }

  await query(`INSERT INTO favorites (user_id, vendor_id) VALUES ($1, $2)`, [userId, vendorId]);
  return NextResponse.json({ ok: true, favorited: true });
}