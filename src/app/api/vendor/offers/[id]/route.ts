import { getVendorByRequest, resolveCategoryName } from "@/lib/vendor-utils";
import { queryOne, withTransaction } from "@/lib/db";
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
    "pack_size", "size_guide", "promo_only", "sku",
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
  // Unidad de venta (balanza): 'kg' o 'unidad'. Tolerante a migración sin aplicar.
  if ("unit" in safeUpdate) {
    const hasUnit = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'unit'
       ) AS exists`
    );
    if (hasUnit?.exists === true) {
      safeUpdate.unit = safeUpdate.unit === "kg" ? "kg" : "unidad";
    } else {
      delete safeUpdate.unit;
    }
  }
  // SKU: tolerante a migración sin aplicar; vacío limpia.
  if ("sku" in safeUpdate) {
    const hasSku = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'sku'
       ) AS exists`
    );
    if (hasSku?.exists === true) {
      safeUpdate.sku =
        safeUpdate.sku != null && String(safeUpdate.sku).trim() !== ""
          ? String(safeUpdate.sku).trim().slice(0, 64)
          : null;
    } else {
      delete safeUpdate.sku;
    }
  }
  if ("sku" in safeUpdate && safeUpdate.sku != null) {
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND sku = $2 AND id <> $3 LIMIT 1`,
      [vendor.id, safeUpdate.sku, params.id]
    ).catch(() => null);
    if (dup) {
      return NextResponse.json({ error: `El código "${safeUpdate.sku}" ya está en otro producto` }, { status: 400 });
    }
  }
  // Costo de compra manual (inventario): tolerante a migración sin aplicar.
  // Solo números >= 0 (null/ausente = sin cambio).
  if ("cost_last" in body) {
    const hasCost = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'cost_last'
       ) AS exists`
    );
    const n = Number(body.cost_last);
    if (hasCost?.exists === true && Number.isFinite(n) && n >= 0) {
      safeUpdate.cost_last = Math.round(n * 100) / 100;
    }
  }
  if ("cash_discount_excluded" in safeUpdate) {
    safeUpdate.cash_discount_excluded = safeUpdate.cash_discount_excluded === true;
  }
  // Solo-promo (vidriera): tolerante a migración sin aplicar.
  if ("promo_only" in safeUpdate) {
    const hasPromoOnly = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'products' AND column_name = 'promo_only'
       ) AS exists`
    );
    if (hasPromoOnly?.exists === true) {
      safeUpdate.promo_only = safeUpdate.promo_only === true;
    } else {
      delete safeUpdate.promo_only;
    }
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

  // Ajuste manual de stock desde el menú: deja rastro en kardex (razón manual).
  let manualDelta: number | null = null;
  if ("stock" in safeUpdate) {
    const prev = await queryOne<{ stock: number | null }>(
      `SELECT stock FROM products WHERE id = $1 AND vendor_id = $2`,
      [params.id, vendor.id]
    ).catch(() => null);
    const oldS = prev?.stock == null ? null : Number(prev.stock);
    const newS = safeUpdate.stock == null ? null : Number(safeUpdate.stock);
    if (oldS != null && Number.isFinite(newS as number) && (newS as number) !== oldS) {
      manualDelta = (newS as number) - oldS;
    }
  }

  const offer = await queryOne<Record<string, unknown>>(
    `UPDATE products SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );
  // Oferta del día única por comercio: al destacar un producto se apaga la
  // oferta anterior del mismo vendor (vale para todos los paneles, que usan
  // este PATCH para el toggle Destacar/Quitar).
  if (safeUpdate.featured_today === true && offer) {
    await queryOne(
      `UPDATE products SET featured_today = false WHERE vendor_id = $1 AND id <> $2`,
      [vendor.id, params.id]
    ).catch(() => {});
  }
  if (manualDelta != null && manualDelta !== 0) {
    const { logStockMovement } = await import("@/lib/stock-ledger");
    await withTransaction(async (tx) => {
      await logStockMovement(tx, {
        vendorId: vendor.id,
        product_id: params.id,
        qty_delta: manualDelta as number,
        reason: "manual",
      });
    }).catch(() => {});
  }

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