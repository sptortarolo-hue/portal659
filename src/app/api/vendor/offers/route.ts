import { getVendorByRequest, resolveCategoryName } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
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

  // Combo artículo: componentes por producto (foto, precio y descripción del
  // componente viajan con el pedido y el combo, no se recalculan).
  // Tolerante a DB sin la tabla (migración sin aplicar).
  const comboItemsByProduct: Record<string, { product_id: string; name: string; price: number; qty: number; image_url: string | null }[]> = {};
  try {
    const crows = await queryMany<{ combo_product_id: string; member_product_id: string; qty: number; position: number }>(
      `SELECT combo_product_id, member_product_id, qty, position FROM combo_items WHERE vendor_id = $1 ORDER BY position ASC`,
      [vendor.id]
    );
    const mrows = await queryMany<{ id: string; name: string; price: number; image_url: string | null }>(
      `SELECT id, name, price, image_url FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const prodById = new Map((mrows || []).map((p) => [String(p.id), p]));
    for (const c of crows || []) {
      const cp = String(c.combo_product_id);
      const m = prodById.get(String(c.member_product_id));
      if (!m) continue;
      if (!comboItemsByProduct[cp]) comboItemsByProduct[cp] = [];
      comboItemsByProduct[cp].push({
        product_id: String(c.member_product_id),
        name: String(m.name),
        price: Number(m.price),
        qty: Math.max(1, Math.round(Number(c.qty) || 1)),
        image_url: m.image_url != null ? String(m.image_url) : null,
      });
    }
  } catch {
    /* sin tabla: map vacío */
  }

  return NextResponse.json({ offers, modifiersByProduct, comboItemsByProduct });
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
  const is_combo = body.is_combo === true;
  const combo_items = Array.isArray(body.combo_items)
    ? body.combo_items
        .filter((x: any) => x && typeof x.product_id === "string")
        .map((x: any) => ({ product_id: String(x.product_id), qty: Math.max(1, Math.round(Number(x.qty) || 1)) }))
    : [];

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

  // Plan: el combo cuenta como un producto (no se excluye del tope).
  // Guardas del combo: componentes del mismo vendor, disponibles, sin
  // auto-referencia ni combos anidados. Tolerante a DB sin la tabla.
  if (is_combo) {
    if (combo_items.length === 0) {
      return NextResponse.json(
        { error: "Un combo necesita al menos un producto componente" },
        { status: 400 }
      );
    }
    try {
      const members = await queryMany<{ id: string; is_combo: boolean }>(
        `SELECT p.id, EXISTS (SELECT 1 FROM combo_items ci WHERE ci.combo_product_id = p.id) AS is_combo
         FROM products p WHERE p.vendor_id = $1 AND p.id = ANY($2)`,
        [vendor.id, combo_items.map((c: { product_id: string; qty: number }) => c.product_id)]
      );
      const mset = new Set((members || []).map((m) => String(m.id)));
      const missing = combo_items.find((c: { product_id: string; qty: number }) => !mset.has(c.product_id));
      if (missing) {
        return NextResponse.json(
          { error: "Algún componente no existe o no es de tu local" },
          { status: 400 }
        );
      }
      if (members.some((m) => m.is_combo)) {
        return NextResponse.json(
          { error: "No se permiten combos dentro de combos" },
          { status: 400 }
        );
      }
    } catch {
      /* sin tabla combo_items: se guardan igual, la FK falla si no existe */
    }
  }

  const extraCols: string[] = [];
  const extraVals: unknown[] = [];
  if (packSize != null) { extraCols.push("pack_size"); extraVals.push(packSize); }
  if (sizeGuide != null) { extraCols.push("size_guide"); extraVals.push(sizeGuide); }
  if (unit != null) { extraCols.push("unit"); extraVals.push(unit); }
  if (sku != null) { extraCols.push("sku"); extraVals.push(sku); }
  // Marca el combo en la descripción (el flag real vive en combo_items).
  // No se agrega columna extra: se deriva de combo_items en runtime.
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
  // Oferta del día única por comercio (igual que el PATCH: el nuevo
  // destacado apaga el anterior del mismo vendor).
  if (!!featured_today && offer) {
    await queryOne(
      `UPDATE products SET featured_today = false WHERE vendor_id = $1 AND id <> $2`,
      [vendor.id, (offer as Record<string, unknown>).id]
    ).catch(() => {});
  }

  // El catálogo cambió: mover el versionado de la tarjeta promo (?v=).
  const { touchPromoVersion } = await import("@/lib/promo-server");
  await touchPromoVersion(vendor.id);

  // Combo: persistir líneas en la misma transacción (tolerante a DB sin tabla).
  if (is_combo) {
    try {
      await withTransaction(async (tx) => {
        await tx.queryVoid(`DELETE FROM combo_items WHERE combo_product_id = $1`, [(offer as any).id]);
        for (let i = 0; i < combo_items.length; i++) {
          const c = combo_items[i];
          await tx.queryVoid(
            `INSERT INTO combo_items (vendor_id, combo_product_id, member_product_id, qty, position)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (combo_product_id, member_product_id) DO UPDATE SET qty = EXCLUDED.qty, position = EXCLUDED.position`,
            [vendor.id, (offer as any).id, c.product_id, c.qty, i]
          );
        }
      });
    } catch {
      /* sin tabla: el combo queda como producto normal */
    }
  }

  return NextResponse.json({ offer, is_combo });
}