import { getVendorByRequest, resolveCategoryName } from "@/lib/vendor-utils";
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
    "has_variants", "stock_control", "requires_prep", "cash_discount_excluded",
    "pack_size", "size_guide",
  ] as const;

  const safeUpdate: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) safeUpdate[key] = body[key];
  }
  // Tolerante a migración de packs sin aplicar: sin la columna, se ignora.
  if ("pack_size" in safeUpdate) {
    const hasPack = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'pack_size'
       ) AS exists`
    );
    if (hasPack?.exists === true) {
      safeUpdate.pack_size =
        Number.isInteger(Number(safeUpdate.pack_size)) && Number(safeUpdate.pack_size) >= 2
          ? Math.floor(Number(safeUpdate.pack_size))
          : null;
    } else {
      delete safeUpdate.pack_size;
    }
  }
  // Guía de talles (moda): tolerante a migración sin aplicar.
  if ("size_guide" in safeUpdate) {
    const hasSizeGuide = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'size_guide'
       ) AS exists`
    );
    if (hasSizeGuide?.exists === true) {
      safeUpdate.size_guide =
        safeUpdate.size_guide && String(safeUpdate.size_guide).trim()
          ? String(safeUpdate.size_guide).trim().slice(0, 2000)
          : null;
    } else {
      delete safeUpdate.size_guide;
    }
  }
  if ("cash_discount_excluded" in safeUpdate) {
    safeUpdate.cash_discount_excluded = safeUpdate.cash_discount_excluded === true;
  }
  // Normalizar categoría igual que al crear (evita variantes duplicadas).
  if ("category" in safeUpdate) {
    safeUpdate.category = await resolveCategoryName(vendor.id, safeUpdate.category);
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