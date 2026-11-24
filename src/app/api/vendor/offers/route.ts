import { getVendorByRequest, resolveCategoryName } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { queryEffectiveModifiers } from "@/lib/modifier-rules";
import { resolveVendorPlan } from "@/lib/plans";
import { isValidDateOnly, toDateOnly } from "@/lib/expiry";
import { normalizePlu } from "@/lib/scale-barcode";
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

  const normalizedOffers = (offers || []).map((o) =>
    "expires_at" in o ? { ...o, expires_at: toDateOnly(o.expires_at) } : o
  );
  return NextResponse.json({ offers: normalizedOffers, modifiersByProduct, comboItemsByProduct });
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

  // Alta desde comprobante de proveedor: se crea con nombre y costo, y el
  // precio de venta se completa después en el catálogo.
  if (!name || (!price && body?.from_invoice !== true)) {
    return NextResponse.json({ error: "El nombre y el precio son obligatorios" }, { status: 400 });
  }
  const effectivePrice = Number(price) || 0;

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

  // PLU de balanza (etiquetas de medida variable). Se guarda normalizado
  // (sin ceros a la izquierda). Tolerante a migración sin aplicar: si se
  // intenta guardar un PLU y la columna no existe se avisa con el archivo;
  // el resto del alta sigue funcionando.
  const hasScalePlu = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'scale_plu'
     ) AS exists`
  ).catch(() => ({ exists: false }));
  let scalePlu: string | null = null;
  if (body.scale_plu != null && String(body.scale_plu).trim() !== "") {
    if (hasScalePlu?.exists !== true) {
      return NextResponse.json(
        { error: "Falta aplicar supabase/self-host/migrate-scale-labels.sql para guardar el PLU de balanza" },
        { status: 503 }
      );
    }
    scalePlu = normalizePlu(body.scale_plu);
    if (!scalePlu) {
      return NextResponse.json({ error: "El PLU de balanza no es válido" }, { status: 400 });
    }
  }

  // Proveedor habitual y vencimiento (inventario): tolerantes a migración sin aplicar.
  const hasSupplierField = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'supplier_id'
     ) AS exists`
  );
  let supplierId: string | null = null;
  if (hasSupplierField?.exists === true && body.supplier_id != null && String(body.supplier_id).trim() !== "") {
    supplierId = String(body.supplier_id).trim();
    const owned = await queryOne<{ id: string }>(
      `SELECT id FROM suppliers WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [supplierId, vendor.id]
    ).catch(() => null);
    if (!owned) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 400 });
    }
  }
  // Alta desde factura: si vino el nombre del proveedor, lo reutiliza o crea.
  if (hasSupplierField?.exists === true && !supplierId && body.supplier_name != null && String(body.supplier_name).trim()) {
    const supplierName = String(body.supplier_name).trim().slice(0, 120);
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM suppliers WHERE vendor_id = $1 AND lower(btrim(name)) = lower($2) LIMIT 1`,
      [vendor.id, supplierName]
    ).catch(() => null);
    if (existing) {
      supplierId = existing.id;
    } else {
      const created = await queryOne<{ id: string }>(
        `INSERT INTO suppliers (vendor_id, name) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [vendor.id, supplierName]
      ).catch(() => null);
      if (created?.id) {
        supplierId = created.id;
      } else {
        const raced = await queryOne<{ id: string }>(
          `SELECT id FROM suppliers
            WHERE vendor_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
          [vendor.id, supplierName]
        ).catch(() => null);
        if (raced?.id) supplierId = raced.id;
      }
    }
  }
  const hasExpiresField = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'expires_at'
     ) AS exists`
  );
  let expiresAt: string | null = null;
  if (hasExpiresField?.exists === true && body.expires_at != null && String(body.expires_at).trim() !== "") {
    if (!isValidDateOnly(body.expires_at)) {
      return NextResponse.json({ error: "Fecha de vencimiento inválida (usá AAAA-MM-DD)" }, { status: 400 });
    }
    expiresAt = toDateOnly(body.expires_at);
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(fullVendor as Vendor, plans || []);
  if (plan.maxProducts != null) {
    // Presentaciones (hijas) no consumen cupo del plan: solo las raíces
    // (parent_id IS NULL) cuentan. Tolerante a migración sin aplicar.
    const hasParentCol = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'parent_id') AS exists`
    ).catch(() => ({ exists: false }));
    const countSql = hasParentCol?.exists === true
      ? `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1 AND parent_id IS NULL`
      : `SELECT count(*)::int AS c FROM products WHERE vendor_id = $1`;
    const countRow = await queryOne<{ c: number }>(countSql, [vendor.id]);
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
  // Un PLU de balanza no puede apuntar a dos productos del mismo comercio.
  if (scalePlu != null) {
    const dupPlu = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM products
       WHERE vendor_id = $1 AND lower(btrim(scale_plu)) = lower($2) LIMIT 1`,
      [vendor.id, scalePlu]
    ).catch(() => null);
    if (dupPlu) {
      return NextResponse.json(
        { error: `El PLU de balanza "${scalePlu}" ya está en “${dupPlu.name}”` },
        { status: 400 }
      );
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
  if (scalePlu != null) { extraCols.push("scale_plu"); extraVals.push(scalePlu); }
  // Envasado (migrate-elaboration.sql): producto "cuento paquetes" + precio online del paquete.
  const hasElaborationCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'count_pack'
     ) AS exists`
  ).catch(() => ({ exists: false }));
  if (body?.count_pack !== undefined || body?.package_price !== undefined) {
    const wantsCountPack = body.count_pack === true;
    const wantsPackagePrice =
      body.package_price !== undefined &&
      body.package_price !== null &&
      String(body.package_price).trim() !== "";
    if (hasElaborationCol?.exists !== true) {
      // Sin migración: se ignora en silencio, salvo que se intente guardar envasado.
      if (wantsCountPack || wantsPackagePrice) {
        return NextResponse.json(
          { error: "Falta aplicar migrate-elaboration.sql para guardar productos envasados" },
          { status: 503 }
        );
      }
    } else {
      if (wantsCountPack && unit !== "kg") {
        return NextResponse.json(
          { error: "Un producto envasado debe ser por kilo (unidad kg)" },
          { status: 400 }
        );
      }
      if (body.count_pack !== undefined) {
        extraCols.push("count_pack");
        extraVals.push(body.count_pack === true);
      }
      if (body.package_price !== undefined) {
        if (body.package_price === null || body.package_price === "") {
          extraCols.push("package_price");
          extraVals.push(null);
        } else {
          const n = Number(body.package_price);
          if (!isFinite(n) || n < 0) {
            return NextResponse.json({ error: "El precio del paquete debe ser un número mayor o igual a 0" }, { status: 400 });
          }
          extraCols.push("package_price");
          extraVals.push(Math.round(n * 100) / 100);
        }
      }
    }
  }
  // Lista de margen (tolerante a migración sin aplicar): valida que la lista sea del comercio.
  const hasMarginListCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'margin_list_id'
     ) AS exists`
  ).catch(() => ({ exists: false }));
  if (hasMarginListCol?.exists === true && body?.margin_list_id) {
    const mlid = String(body.margin_list_id).trim();
    if (mlid) {
      const owned = await queryOne<{ id: string }>(
        `SELECT id FROM margin_lists WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [mlid, vendor.id]
      ).catch(() => null);
      if (owned) { extraCols.push("margin_list_id"); extraVals.push(owned.id); }
    }
  }
  // Marca el combo en la descripción (el flag real vive en combo_items).
  // No se agrega columna extra: se deriva de combo_items en runtime.
  // Costo de compra manual (inventario): tolerante a migración sin aplicar.
  const hasCostLast = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'cost_last'
     ) AS exists`
  );
  const costLastNum = body?.cost_last == null || body.cost_last === "" ? null : Number(body.cost_last);
  if (hasCostLast?.exists === true && costLastNum != null && Number.isFinite(costLastNum) && costLastNum >= 0) {
    extraCols.push("cost_last");
    extraVals.push(Math.round(costLastNum * 100) / 100);
  }
  if (supplierId != null) { extraCols.push("supplier_id"); extraVals.push(supplierId); }
  if (expiresAt != null) { extraCols.push("expires_at"); extraVals.push(expiresAt); }
  // Presentaciones (migrate-product-presentations.sql): tolerante a migración sin aplicar.
  const hasParentCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'parent_id') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasParentCol?.exists === true) {
    if (body?.parent_id != null && String(body.parent_id).trim() !== "") {
      extraCols.push("parent_id");
      extraVals.push(String(body.parent_id).trim());
    }
    if (body?.presentation_label != null && String(body.presentation_label).trim() !== "") {
      extraCols.push("presentation_label");
      extraVals.push(String(body.presentation_label).trim().slice(0, 64));
    }
    if (body?.presentation_qty != null && String(body.presentation_qty).trim() !== "") {
      const pq = Number(body.presentation_qty);
      if (Number.isFinite(pq) && pq > 0) {
        extraCols.push("presentation_qty");
        extraVals.push(pq);
      }
    }
    if (body?.presentation_unit != null && String(body.presentation_unit).trim() !== "") {
      const pu = String(body.presentation_unit).trim();
      if (pu === "kg" || pu === "u" || pu === "ml") {
        extraCols.push("presentation_unit");
        extraVals.push(pu);
      }
    }
  }
  // Venta online on/off (taller): tolerante a migración sin aplicar.
  const hasOnlineAvailableCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'online_available') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasOnlineAvailableCol?.exists === true && body?.online_available !== undefined) {
    extraCols.push("online_available");
    extraVals.push(body.online_available === true);
  }
  // Productos sugeribles en el carrito (migrate-product-suggestions.sql):
  // tolerante a migración sin aplicar. Valida elegibilidad si se intenta
  // marcar suggestible = true.
  const hasSuggestibleCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'suggestible') AS exists`
  ).catch(() => ({ exists: false }));
  if (body?.suggestible !== undefined) {
    if (hasSuggestibleCol?.exists !== true) {
      if (body.suggestible === true) {
        return NextResponse.json(
          { error: "Falta aplicar migrate-product-suggestions.sql para marcar productos sugeribles" },
          { status: 503 }
        );
      }
    } else {
      if (body.suggestible === true) {
        // El producto aún no existe (es alta): la validación estricta de
        // elegibilidad se hace en el toggle post-creación (PATCH). Acá solo
        // se persiste el flag si la migración está aplicada.
      }
      extraCols.push("suggestible");
      extraVals.push(body.suggestible === true);
      if (body.suggestible === true) {
        // posición = max actual + 1
        const maxPos = await queryOne<{ m: number | null }>(
          `SELECT COALESCE(MAX(suggestible_position), 0) AS m FROM products WHERE vendor_id = $1`,
          [vendor.id]
        ).catch(() => ({ m: 0 }));
        extraCols.push("suggestible_position");
        extraVals.push((Number(maxPos?.m) || 0) + 1);
      } else {
        extraCols.push("suggestible_position");
        extraVals.push(0);
      }
    }
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
  let offer: Record<string, unknown> | undefined = undefined;
  try {
    offer = await queryOne<Record<string, unknown>>(
      `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today, image_url, stock, stock_low_threshold, stock_control, requires_prep, has_variants, cash_discount_excluded${extraCols.length ? ", " + extraCols.join(", ") : ""})
       VALUES ($1, $2, $3, $4, 'ARS', $5, $6, 'food', true, $7, $8, $9, $10, $11, $12, $13, $14${extraPlaceholders ? ", " + extraPlaceholders : ""}) RETURNING *`,
      [
        vendor.id,
        name,
        description || null,
        parseFloat(String(effectivePrice)),
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
  } catch (e: any) {
    console.error("[offers/post] insert failed", {
      message: e?.message,
      cols: extraCols,
      vals: extraVals,
      body: { name, price: effectivePrice, from_invoice: body?.from_invoice === true },
    });
    throw e;
  }
  // Pasos posteriores al insert: best-effort. El producto ya quedó guardado;
  // si algo acá falla no debe mostrarse como "no se pudo crear".
  try {
    if (!!featured_today && offer) {
      await queryOne(
        `UPDATE products SET featured_today = false WHERE vendor_id = $1 AND id <> $2`,
        [vendor.id, (offer as Record<string, unknown>).id]
      ).catch(() => {});
    }
    const { touchPromoVersion } = await import("@/lib/promo-server");
    await touchPromoVersion(vendor.id);
  } catch {
    /* best-effort */
  }

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