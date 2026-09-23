import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ gallery: [] });

  const gallery = await queryMany<Record<string, unknown>>(
    `SELECT * FROM vendor_gallery WHERE vendor_id = $1 ORDER BY position ASC`,
    [vendor.id]
  );

  return NextResponse.json({ gallery: gallery || [] });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const body = await request.json();
  const { image_url, caption } = body;

  if (!image_url) return NextResponse.json({ error: "Falta image_url" }, { status: 400 });

  const countRow = await queryOne<{ c: number }>(
    `SELECT count(*)::int AS c FROM vendor_gallery WHERE vendor_id = $1`,
    [vendor.id]
  );

  const item = await queryOne<Record<string, unknown>>(
    `INSERT INTO vendor_gallery (vendor_id, image_url, caption, position)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [vendor.id, image_url, caption || null, countRow?.c || 0]
  );

  return NextResponse.json({ item });
}
