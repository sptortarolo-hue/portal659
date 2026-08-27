import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const allowedFields = [
    "name", "description", "price", "category", "image_url",
    "available", "featured_today", "stock", "promo_price",
    "stock_low_threshold", "currency", "neighborhood", "type", "unit",
    "has_variants",
  ] as const;

  const safeUpdate: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) safeUpdate[key] = body[key];
  }
  if (Object.keys(safeUpdate).length === 0) {
    return NextResponse.json({ error: "No hay campos válidos para actualizar" }, { status: 400 });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [params.id, vendor.id];
  let idx = 3;
  for (const [key, val] of Object.entries(safeUpdate)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }

  const offer = await queryOne<Record<string, unknown>>(
    `UPDATE products SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );

  return NextResponse.json({ offer });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await queryOne(
    `DELETE FROM products WHERE id = $1 AND vendor_id = $2 RETURNING id`,
    [params.id, vendor.id]
  );

  return NextResponse.json({ ok: true });
}