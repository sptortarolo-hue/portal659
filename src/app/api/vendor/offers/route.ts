import { getVendorByRequest, resolveCategoryName } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { queryEffectiveModifiers } from "@/lib/modifier-rules";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";
import type { Plan, Vendor } from "@/types/database";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const offers = await queryMany<Record<string, unknown>>(
    `SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at DESC`,
    [vendor.id]
  );

  const productIds = offers?.map((o) => o.id as string) || [];
  let allModifiers: Record<string, unknown>[] = [];
  if (productIds.length > 0) {
    try {
      // Valores efectivos (override por link si existe) con fallback por nivel
      // de migración adentro del helper; legacy solo si no hay tablas nuevas.
      allModifiers = await queryEffectiveModifiers(queryMany, productIds);
    } catch {
      try {
        allModifiers = await queryMany<Record<string, unknown>>(
          `SELECT id, product_id, group_name, options, required, max_selections, position
           FROM product_modifiers
           WHERE product_id = ANY($1)
           ORDER BY position ASC`,
          [productIds]
        );
      } catch {
        allModifiers = [];
      }
    }
  }

  const modifiersByProduct: Record<string, Record<string, unknown>[]> = {};
  for (const mod of allModifiers) {
    const pid = mod.product_id as string;
    if (!modifiersByProduct[pid]) modifiersByProduct[pid] = [];
    modifiersByProduct[pid].push(mod);
  }

  return NextResponse.json({ offers, modifiersByProduct });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }

  const fullVendor = await queryOne<Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );
  const body = await request.json();
  const { name, description, price, category, featured_today, image_url } = body;  const stock = body.stock ?? null;
  const stock_low_threshold = body.stock_low_threshold ?? null;
  const stock_control = body.stock_control ?? false;
  const requires_prep = body.requires_prep !== false;
  const has_variants = body.has_variants === true;
  const cash_discount_excluded = body.cash_discount_excluded === true;

  if (!name || !price) {
    return NextResponse.json({ error: "El nombre y el precio son obligatorios" }, { status: 400 });
  }

  // Tolerante a migración de packs sin aplicar: sin la columna, se ignora.
  const hasPack = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'pack_size'
     ) AS exists`
  );
  const packSize =
    hasPack?.exists === true && Number.isInteger(Number(body.pack_size)) && Number(body.pack_size) >= 2
      ? Math.floor(Number(body.pack_size))
      : null;

  // Unidad de venta (balanza): 'kg' = precio por kilo, fraccionado.
  // Tolerante a migración sin aplicar: sin la columna, se ignora.
  const hasUnit = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'unit'
     ) AS exists`
  );
  const unit =
    hasUnit?.exists === true && (body.unit === "kg" || body.unit === "unidad")
      ? body.unit
      : null;

  // SKU / código de barras: tolerante a migración sin aplicar.
  const hasSku = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'sku'
     ) AS exists`
  );
  const sku =
    hasSku?.exists === true && body.sku != null && String(body.sku).trim() !== ""
      ? String(body.sku).trim().slice(0, 64)
      : null;

  // Guía de talles (moda): texto, una línea por talle. Tolerante a migración sin aplicar.
  const hasSizeGuide = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'size_guide'
     ) AS exists`
  );
  const sizeGuide =
    hasSizeGuide?.exists === true && body.size_guide && String(body.size_guide).trim()
      ? String(body.size_guide).trim().slice(0, 2000)
      : null;

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(fullVendor as Vendor, plans || []);
  if (plan.maxProducts != null) {
    const countRow = await queryOne<{ c: number }>(
      `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const count = countRow?.c || 0;
    if (count >= plan.maxProducts) {
      return NextResponse.json(
        {
          error: `Tu plan permite hasta ${plan.maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`,
          code: "plan_limit",
        },
        { status: 403 }
      );
    }
  }

  if (sku != null) {
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND sku = $2 LIMIT 1`,
      [vendor.id, sku]
    ).catch(() => null);
    if (dup) {
      return NextResponse.json({ error: `El código "${sku}" ya está en otro producto` }, { status: 400 });
    }
  }

  const extraCols: string[] = [];
  const extraVals: unknown[] = [];
  if (packSize != null) { extraCols.push("pack_size"); extraVals.push(packSize); }
  if (sizeGuide != null) { extraCols.push("size_guide"); extraVals.push(sizeGuide); }
  if (unit != null) { extraCols.push("unit"); extraVals.push(unit); }
  if (sku != null) { extraCols.push("sku"); extraVals.push(sku); }
  // Costo de compra manual (inventario): tolerante a migración sin aplicar.
  const hasCostLast = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'cost_last'
     ) AS exists`
  );
  const costLastNum = Number(body?.cost_last);
  if (hasCostLast?.exists === true && Number.isFinite(costLastNum) && costLastNum >= 0) {
    extraCols.push("cost_last");
    extraVals.push(Math.round(costLastNum * 100) / 100);
  }
  const extraPlaceholders = extraVals.map((_, i) => `$${15 + i}`).join(", ");
  // Foto remota sugerida por lookup (Open Food Facts): se descarga a uploads
  // para no hotlinkear. Si falla, se guarda la URL tal cual (no rompe el alta).
  let finalImageUrl: string | null = (image_url as string) || null;
  if (finalImageUrl && /^https?:\/\//.test(finalImageUrl)) {
    try {
      const site = getSiteUrl();
      if (!finalImageUrl.startsWith(site)) {
        const { downloadRemoteImage } = await import("@/lib/remote-image");
        finalImageUrl = (await downloadRemoteImage(finalImageUrl, vendor.id, "offers")) || finalImageUrl;
      }
    } catch {
      /* noop */
    }
  }
  const offer = await queryOne<Record<string, unknown>>(
    `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today, image_url, stock, stock_low_threshold, stock_control, requires_prep, has_variants, cash_discount_excluded${extraCols.length ? ", " + extraCols.join(", ") : ""})
     VALUES ($1, $2, $3, $4, 'ARS', $5, $6, 'food', true, $7, $8, $9, $10, $11, $12, $13, $14${extraPlaceholders ? ", " + extraPlaceholders : ""}) RETURNING *`,
    [
      vendor.id,
      name,
      description || null,
      parseFloat(price),
      await resolveCategoryName(vendor.id, category),
      fullVendor?.neighborhood || null,
      !!featured_today,
      finalImageUrl,
      stock,
      stock_low_threshold,
      stock_control,
      requires_prep,
      has_variants,
      cash_discount_excluded,
      ...extraVals,
    ]
  );

  return NextResponse.json({ offer });
}