import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Genera N presentaciones a partir de un producto raíz.
 *
 * Body: {
 *   source_id: string,
 *   presentations: [{ label, qty, unit, price?, create: boolean }],
 *   share: { image, description, category, supplier, recipe, expiry, stock_control, margin_list },
 *   pricing_mode: "manual" | "base_plus_packaging" | "margin_pct" | "markup_pct",
 *   base_price_per_kg?: number,
 *   packaging_pct_by_range?: [{ max_qty: number, pct: number }]
 * }
 */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No tenés un local registrado" }, { status: 403 });
  }
  const vendorId = vendor.id;

  const body = await request.json().catch(() => ({}));
  const sourceId = String(body?.source_id || "").trim();
  if (!sourceId) {
    return NextResponse.json({ error: "Falta el producto de origen" }, { status: 400 });
  }

  const source = await queryOne<Record<string, unknown>>(
    `SELECT * FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [sourceId, vendorId]
  );
  if (!source) {
    return NextResponse.json({ error: "Producto de origen no encontrado" }, { status: 404 });
  }

  const presentations: any[] = Array.isArray(body?.presentations) ? body.presentations : [];
  if (presentations.length === 0) {
    return NextResponse.json({ error: "Agregá al menos una presentación" }, { status: 400 });
  }

  const share = body?.share || {};
  const shareImage = share.image !== false;
  const shareDesc = share.description !== false;
  const shareCategory = share.category !== false;
  const shareSupplier = share.supplier !== false;
  const shareExpiry = share.expiry !== false;
  const shareStockControl = share.stock_control !== false;
  const shareMarginList = share.margin_list !== false;
  const shareRecipe = share.recipe !== false;

  const pricingMode = String(body?.pricing_mode || "manual");
  const basePricePerKg = Number(body?.base_price_per_kg) || Number(source.price) || 0;
  const packagingRanges: { max_qty: number; pct: number }[] = Array.isArray(body?.packaging_pct_by_range)
    ? body.packaging_pct_by_range
    : [];

  function packagingPctForQty(qty: number): number {
    for (const r of packagingRanges) {
      if (qty <= r.max_qty) return Number(r.pct) || 0;
    }
    return 0;
  }

  const hasParentCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'parent_id') AS exists`
  ).catch(() => ({ exists: false }));

  if (hasParentCol?.exists !== true) {
    return NextResponse.json(
      { error: "Falta aplicar migrate-product-presentations.sql para crear presentaciones" },
      { status: 503 }
    );
  }

  // Plan limit check (solo raíces).
  const toCreate = presentations.filter((p) => p && p.create !== false);
  if (toCreate.length > 0) {
    const vendorRow = await queryOne<{ plan_id: string | null }>(
      `SELECT plan_id FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );
    let maxProducts: number | null = null;
    if (vendorRow?.plan_id) {
      const planRow = await queryOne<{ max_products: number | null }>(
        `SELECT max_products FROM plans WHERE id = $1 LIMIT 1`,
        [vendorRow.plan_id]
      );
      maxProducts = planRow?.max_products ?? null;
    }
    if (maxProducts != null) {
      const countRow = await queryOne<{ c: number }>(
        `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1 AND parent_id IS NULL`,
        [vendorId]
      );
      const count = countRow?.c || 0;
      if (count + toCreate.length > maxProducts) {
        return NextResponse.json(
          { error: `Tu plan permite hasta ${maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`, code: "plan_limit" },
          { status: 403 }
        );
      }
    }
  }

  // Helper: clonar receta para una presentación.
  async function cloneRecipeForPresentation(
    newProductId: string,
    sourceQty: number,
    presQty: number
  ): Promise<void> {
    if (!shareRecipe) return;
    const ratio = sourceQty > 0 ? presQty / sourceQty : 1;
    try {
      // Receta propia del fuente.
      const srcRecipe = await queryOne<{ id: string; yield_qty: number | null }>(
        `SELECT id, yield_qty FROM recipes WHERE product_id = $1 AND vendor_id = $2 LIMIT 1`,
        [sourceId, vendorId]
      );
      if (srcRecipe) {
        const newRecipe = await queryOne<{ id: string }>(
          `INSERT INTO recipes (vendor_id, product_id, name, yield_qty, yield_unit, notes)
           SELECT vendor_id, $2, name, yield_qty, yield_unit, notes
           FROM recipes WHERE id = $1 RETURNING id`,
          [srcRecipe.id, newProductId]
        );
        if (newRecipe) {
          // Clonar líneas: granel escalado por ratio, packaging (u) en cantidad 1.
          const srcLines = await queryMany<{ ingredient_id: string; qty_net: number; unit: string; position: number; base_unit?: string }>(
            `SELECT ri.ingredient_id, ri.qty_net, ri.unit, ri.position,
                    i.base_unit
             FROM recipe_items ri
             JOIN ingredients i ON i.id = ri.ingredient_id
             WHERE ri.recipe_id = $1`,
            [srcRecipe.id]
          );
          for (const line of srcLines || []) {
            const isPackaging = line.base_unit === "u" || line.unit === "u";
            const scaledQty = isPackaging ? line.qty_net : line.qty_net * ratio;
            await queryOne(
              `INSERT INTO recipe_items (recipe_id, ingredient_id, qty_net, unit, position)
               VALUES ($1, $2, $3, $4, $5)`,
              [newRecipe.id, line.ingredient_id, scaledQty, line.unit, line.position]
            ).catch(() => {});
          }
        }
        return;
      }
      // Link: crear link con servings ajustado.
      const srcLink = await queryOne<{ recipe_id: string; servings: number }>(
        `SELECT recipe_id, servings FROM product_recipe_links WHERE product_id = $1 LIMIT 1`
      ).catch(() => null);
      if (srcLink) {
        await queryOne(
          `INSERT INTO product_recipe_links (recipe_id, product_id, servings)
           VALUES ($1, $2, $3)
           ON CONFLICT (product_id) DO NOTHING`,
          [srcLink.recipe_id, newProductId, (srcLink.servings || 1) * ratio]
        ).catch(() => {});
      }
    } catch {
      // Receta no se pudo clonar: no rompe el alta.
    }
  }

  const sourceQty = Number(source.presentation_qty) || 1;
  const created: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];

  for (const pres of presentations) {
    if (!pres || pres.create === false) {
      skipped.push({ label: pres?.label, reason: "no_create" });
      continue;
    }
    const label = String(pres.label || "").trim();
    if (!label) {
      errors.push({ label: pres.label, error: "Falta el nombre de la presentación" });
      continue;
    }
    const qty = Number(pres.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({ label, error: "La cantidad debe ser mayor a 0" });
      continue;
    }
    const unit = String(pres.unit || "kg").trim();
    if (unit !== "kg" && unit !== "u" && unit !== "ml") {
      errors.push({ label, error: "Unidad inválida (kg, u o ml)" });
      continue;
    }

    // Calcular precio según modo.
    let price = Number(pres.price);
    if (pricingMode === "base_plus_packaging" && basePricePerKg > 0) {
      const pct = packagingPctForQty(qty);
      price = Math.round(basePricePerKg * qty * (1 + pct / 100));
    } else if (!Number.isFinite(price) || price < 0) {
      price = Number(source.price) || 0;
    }

    // Build extraCols/extraVals.
    const extraCols: string[] = [];
    const extraVals: unknown[] = [];

    // parent_id
    extraCols.push("parent_id");
    extraVals.push(String(source.id));
    // presentation_label
    extraCols.push("presentation_label");
    extraVals.push(label.slice(0, 64));
    // presentation_qty
    extraCols.push("presentation_qty");
    extraVals.push(qty);
    // presentation_unit
    extraCols.push("presentation_unit");
    extraVals.push(unit);

    // share fields.
    if (shareSupplier && source.supplier_id) {
      const hasSupplier = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'supplier_id') AS exists`
      ).catch(() => ({ exists: false }));
      if (hasSupplier?.exists === true) {
        extraCols.push("supplier_id");
        extraVals.push(source.supplier_id);
      }
    }
    if (shareExpiry && source.expires_at) {
      const hasExpires = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'expires_at') AS exists`
      ).catch(() => ({ exists: false }));
      if (hasExpires?.exists === true) {
        extraCols.push("expires_at");
        extraVals.push(source.expires_at);
      }
    }
    if (shareMarginList && source.margin_list_id) {
      const hasMl = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'margin_list_id') AS exists`
      ).catch(() => ({ exists: false }));
      if (hasMl?.exists === true) {
        extraCols.push("margin_list_id");
        extraVals.push(source.margin_list_id);
      }
    }
    const hasCostLastPres = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'cost_last') AS exists`
    ).catch(() => ({ exists: false }));
    if (hasCostLastPres?.exists === true && source.cost_last != null) {
      extraCols.push("cost_last");
      extraVals.push(source.cost_last);
      extraCols.push("cost_avg");
      extraVals.push(source.cost_avg);
    }
    // Optional cols (tolerant).
    const optionalCols: { col: string; val: unknown }[] = [
      { col: "pack_size", val: source.pack_size },
      { col: "unit", val: source.unit },
      { col: "count_pack", val: source.count_pack },
      { col: "package_price", val: source.package_price },
      { col: "weight_step_kg", val: source.weight_step_kg },
      { col: "weight_min_kg", val: source.weight_min_kg },
      { col: "size_guide", val: shareDesc ? source.size_guide : null },
      { col: "online_available", val: source.online_available },
    ];
    for (const { col, val } of optionalCols) {
      const hasCol = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = $1) AS exists`,
        [col]
      ).catch(() => ({ exists: false }));
      if (hasCol?.exists === true) {
        extraCols.push(col);
        extraVals.push(val);
      }
    }

    // Cast explícito para evitar "could not determine data type" cuando un
    // valor es null/undefined (Postgres no infiere el tipo del parámetro).
    const extraPlaceholders = extraVals.map((v, i) => {
      const col = extraCols[i];
      if (col === "parent_id") return `$${14 + i}::uuid`;
      if (col === "presentation_qty" || col === "cost_last" || col === "cost_avg" || col === "weight_step_kg" || col === "weight_min_kg" || col === "package_price") return `$${14 + i}::numeric`;
      if (col === "stock_low_threshold") return `$${14 + i}::int`;
      if (col === "stock_control" || col === "requires_prep" || col === "has_variants" || col === "cash_discount_excluded" || col === "count_pack" || col === "online_available") return `$${14 + i}::boolean`;
      return `$${14 + i}`;
    }).join(", ");

    try {
      const newProduct = await queryOne<Record<string, unknown>>(
        `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today, image_url, stock, stock_low_threshold, stock_control, requires_prep, has_variants, cash_discount_excluded${extraCols.length ? ", " + extraCols.join(", ") : ""})
         VALUES ($1, $2, $3, $4, 'ARS', $5, $6, $7, true, false, $8, 0, $9, $10, $11, $12, $13${extraPlaceholders ? ", " + extraPlaceholders : ""}) RETURNING *`,
        [
          vendorId,
          `${source.name} ${label}`,
          shareDesc ? (source.description || null) : null,
          price,
          shareCategory ? (source.category || null) : null,
          source.neighborhood || null,
          source.type || "food",
          shareImage ? (source.image_url || null) : null,
          shareStockControl ? (source.stock_low_threshold ?? null) : null,
          shareStockControl ? (source.stock_control ?? false) : false,
          source.requires_prep !== false,
          source.has_variants === true,
          source.cash_discount_excluded === true,
          ...extraVals,
        ]
      );

      if (!newProduct) {
        errors.push({ label, error: "No se pudo crear la presentación" });
        continue;
      }

      // Clonar receta.
      await cloneRecipeForPresentation(String(newProduct.id), sourceQty, qty);

      created.push(newProduct);
    } catch (e: any) {
      errors.push({ label, error: String(e?.message || e) });
    }
  }

  return NextResponse.json({ created, skipped, errors }, { status: created.length > 0 ? 201 : 400 });
}