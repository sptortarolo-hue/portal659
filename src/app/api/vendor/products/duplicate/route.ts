import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Clona un producto existente. Si se pasa parent_id (o presentation_*), el clon
 * queda como presentación de la familia. Sin parent_id, es un producto
 * independiente (duplicado puro).
 *
 * Body: { source_id, name?, price?, parent_id?, presentation_label?,
 *         presentation_qty?, presentation_unit?, share? }
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

  // Cargar el producto fuente (solo del mismo vendor).
  const source = await queryOne<Record<string, unknown>>(
    `SELECT * FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [sourceId, vendorId]
  );
  if (!source) {
    return NextResponse.json({ error: "Producto de origen no encontrado" }, { status: 404 });
  }

  // Plan limit: solo las raíces consumen cupo.
  const hasParentCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'parent_id') AS exists`
  ).catch(() => ({ exists: false }));

  const parentId = body?.parent_id != null && String(body.parent_id).trim() !== ""
    ? String(body.parent_id).trim()
    : null;

  if (hasParentCol?.exists === true && parentId === null) {
    // Clon puro (no presentación): cuenta como raíz nueva.
    const plans = await queryMany<{ max_products: number | null }>(
      `SELECT max_products FROM plans WHERE id IN (SELECT plan_id FROM vendors WHERE id = $1)`,
      [vendorId]
    ).catch(() => []);
    // Fallback: contar raíces actuales.
    const countRow = await queryOne<{ c: number }>(
      `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1 AND parent_id IS NULL`,
      [vendorId]
    );
    const count = countRow?.c || 0;
    // Resolver maxProducts del plan del vendor.
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
    if (maxProducts != null && count >= maxProducts) {
      return NextResponse.json(
        { error: `Tu plan permite hasta ${maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`, code: "plan_limit" },
        { status: 403 }
      );
    }
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

  const name = body?.name != null ? String(body.name).trim() : String(source.name);
  if (!name) {
    return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
  }
  const price = body?.price != null ? parseFloat(body.price) : Number(source.price);
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: "El precio debe ser un número válido" }, { status: 400 });
  }

  // Build extraCols/extraVals (tolerante a migración sin aplicar).
  const extraCols: string[] = [];
  const extraVals: unknown[] = [];

  // parent_id
  if (hasParentCol?.exists === true && parentId !== null) {
    extraCols.push("parent_id");
    extraVals.push(parentId);
  }
  // presentation_label
  if (hasParentCol?.exists === true && body?.presentation_label != null && String(body.presentation_label).trim() !== "") {
    extraCols.push("presentation_label");
    extraVals.push(String(body.presentation_label).trim().slice(0, 64));
  }
  // presentation_qty
  if (hasParentCol?.exists === true && body?.presentation_qty != null) {
    const pq = Number(body.presentation_qty);
    if (Number.isFinite(pq) && pq > 0) {
      extraCols.push("presentation_qty");
      extraVals.push(pq);
    }
  }
  // presentation_unit
  if (hasParentCol?.exists === true && body?.presentation_unit != null) {
    const pu = String(body.presentation_unit).trim();
    if (pu === "kg" || pu === "u" || pu === "ml") {
      extraCols.push("presentation_unit");
      extraVals.push(pu);
    }
  }
  // supplier_id
  if (shareSupplier && source.supplier_id) {
    const hasSupplier = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'supplier_id') AS exists`
    ).catch(() => ({ exists: false }));
    if (hasSupplier?.exists === true) {
      extraCols.push("supplier_id");
      extraVals.push(source.supplier_id);
    }
  }
  // expires_at
  if (shareExpiry && source.expires_at) {
    const hasExpires = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'expires_at') AS exists`
    ).catch(() => ({ exists: false }));
    if (hasExpires?.exists === true) {
      extraCols.push("expires_at");
      extraVals.push(source.expires_at);
    }
  }
  // margin_list_id
  if (shareMarginList && source.margin_list_id) {
    const hasMl = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'margin_list_id') AS exists`
    ).catch(() => ({ exists: false }));
    if (hasMl?.exists === true) {
      extraCols.push("margin_list_id");
      extraVals.push(source.margin_list_id);
    }
  }
  // cost_last / cost_avg
  const hasCostLast = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'cost_last') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasCostLast?.exists === true && source.cost_last != null) {
    extraCols.push("cost_last");
    extraVals.push(source.cost_last);
    extraCols.push("cost_avg");
    extraVals.push(source.cost_avg);
  }
  // pack_size, unit, count_pack, package_price, weight_step_kg, weight_min_kg, scale_plu, size_guide
  const optionalCols = [
    { col: "pack_size", val: source.pack_size },
    { col: "unit", val: source.unit },
    { col: "count_pack", val: source.count_pack },
    { col: "package_price", val: source.package_price },
    { col: "weight_step_kg", val: source.weight_step_kg },
    { col: "weight_min_kg", val: source.weight_min_kg },
    { col: "scale_plu", val: null }, // PLU no se copia (debe ser único)
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

  const extraPlaceholders = extraVals.map((_, i) => `$${17 + i}`).join(", ");

  const newProduct = await queryOne<Record<string, unknown>>(
    `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today, image_url, stock, stock_low_threshold, stock_control, requires_prep, has_variants, cash_discount_excluded${extraCols.length ? ", " + extraCols.join(", ") : ""})
     VALUES ($1, $2, $3, $4, 'ARS', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16${extraPlaceholders ? ", " + extraPlaceholders : ""}) RETURNING *`,
    [
      vendorId,
      name,
      shareDesc ? (source.description || null) : null,
      price,
      shareCategory ? (source.category || null) : null,
      source.neighborhood || null,
      source.type || "food",
      source.available !== false,
      false, // featured_today no se copia
      shareImage ? (source.image_url || null) : null,
      0, // stock
      shareStockControl ? (source.stock_low_threshold ?? null) : null,
      shareStockControl ? (source.stock_control ?? false) : false,
      source.requires_prep !== false,
      source.has_variants === true,
      source.cash_discount_excluded === true,
      ...extraVals,
    ]
  );

  if (!newProduct) {
    return NextResponse.json({ error: "No se pudo crear el producto" }, { status: 500 });
  }

  // Copiar receta si share.recipe.
  if (shareRecipe) {
    try {
      // Receta propia del fuente.
      const srcRecipe = await queryOne<{ id: string }>(
        `SELECT id FROM recipes WHERE product_id = $1 AND vendor_id = $2 LIMIT 1`,
        [sourceId, vendorId]
      );
      if (srcRecipe) {
        // Crear receta clonada para el nuevo producto.
        const newRecipe = await queryOne<{ id: string }>(
          `INSERT INTO recipes (vendor_id, product_id, name, yield_qty, yield_unit, notes)
           SELECT vendor_id, $2, name, yield_qty, yield_unit, notes
           FROM recipes WHERE id = $1 RETURNING id`,
          [srcRecipe.id, newProduct.id]
        );
        if (newRecipe) {
          await queryOne(
            `INSERT INTO recipe_items (recipe_id, ingredient_id, qty_net, unit, position)
             SELECT $2, ingredient_id, qty_net, unit, position
             FROM recipe_items WHERE recipe_id = $1`,
            [srcRecipe.id, newRecipe.id]
          ).catch(() => {});
        }
      } else {
        // Link: crear link con servings ajustado.
        const srcLink = await queryOne<{ recipe_id: string; servings: number }>(
          `SELECT recipe_id, servings FROM product_recipe_links WHERE product_id = $1 LIMIT 1`
        ).catch(() => null);
        if (srcLink) {
          // Verificar que el nuevo producto no tenga receta propia (no debería).
          await queryOne(
            `INSERT INTO product_recipe_links (recipe_id, product_id, servings)
             VALUES ($1, $2, $3)
             ON CONFLICT (product_id) DO NOTHING`,
            [srcLink.recipe_id, newProduct.id, srcLink.servings]
          ).catch(() => {});
        }
      }
    } catch {
      // Receta no se pudo copiar: no rompe el alta.
    }
  }

  return NextResponse.json({ product: newProduct }, { status: 201 });
}