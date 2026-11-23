import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction, hasColumn, hasTable, type Tx } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

const MAX_SIZE = 15 * 1024 * 1024;

function normKey(k: string): string {
  return String(k).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_-]+/g, "");
}

function cellVal(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && (v as any).richText) {
    return (v as any).richText.map((r: any) => r.text || "").join("");
  }
  if (typeof v === "object" && (v as any).text) return String((v as any).text);
  return String(v).trim();
}

async function readSheet(wb: ExcelJS.Workbook, name: string): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const sheet = wb.getWorksheet(name);
  if (!sheet) return { headers: [], rows: [] };
  const allRows: string[][] = [];
  sheet.eachRow((row) => {
    allRows.push((row.values as unknown[]).slice(1).map((v) => cellVal(v)));
  });
  if (allRows.length === 0) return { headers: [], rows: [] };
  const headers = allRows[0];
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (r.every((c) => c === "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => { if (h) obj[h] = r[idx] ?? ""; });
    rows.push(obj);
  }
  return { headers, rows };
}

function boolVal(v: unknown): boolean | null {
  if (v === "" || v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "si" || s === "sí" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return null;
}

function numVal(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const form = await request.formData();
  const action = (form.get("action") as string) || "analyze";
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Subí un archivo .xlsx" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "El archivo supera los 15 MB" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as any);
  } catch {
    return NextResponse.json({ error: "No se pudo leer el Excel" }, { status: 400 });
  }

  const productsSheet = await readSheet(wb, "Productos");
  if (productsSheet.rows.length === 0) {
    return NextResponse.json({ error: "La hoja 'Productos' está vacía" }, { status: 400 });
  }

  // Map headers by normalized key
  const headerMap: Record<string, string> = {};
  productsSheet.headers.forEach((h) => {
    if (h) headerMap[normKey(h)] = h;
  });

  function col(row: Record<string, unknown>, ...keys: string[]): unknown {
    for (const k of keys) {
      const nk = normKey(k);
      // find header that normalizes to nk
      for (const [nh, orig] of Object.entries(headerMap)) {
        if (nh === nk) return row[orig];
      }
    }
    return undefined;
  }

  const fullVendor = await queryOne<any>(`SELECT * FROM vendors WHERE id = $1`, [vendor.id]);
  const plans = await queryMany<any>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(fullVendor, plans || []);

  const existingProducts = await queryMany<any>(`SELECT id, name, sku FROM products WHERE vendor_id = $1`, [vendor.id]);
  const existingBySku = new Map(existingProducts.filter((p: any) => p.sku).map((p: any) => [String(p.sku).trim(), p]));
  const existingByName = new Map(existingProducts.map((p: any) => [String(p.name).trim().toLowerCase(), p]));
  const existingById = new Map(existingProducts.map((p: any) => [p.id, p]));

  // Variantes sheet
  const variantsSheet = await readSheet(wb, "Variantes");

  // Modificadores sheet
  const modifiersSheet = await readSheet(wb, "Modificadores");
  const modifiersByProduct = new Map<string, Record<string, unknown>[]>();
  for (const r of modifiersSheet.rows) {
    const pid = String(col(r, "producto_id", "product_id") || "").trim();
    const psku = String(col(r, "producto_sku") || "").trim();
    const key = pid || psku;
    if (!key) continue;
    if (!modifiersByProduct.has(key)) modifiersByProduct.set(key, []);
    modifiersByProduct.get(key)!.push(r);
  }

  // Imágenes sheet
  const imagesSheet = await readSheet(wb, "Imagenes");
  const imagesByProduct = new Map<string, Record<string, unknown>[]>();
  for (const r of imagesSheet.rows) {
    const pid = String(col(r, "producto_id", "product_id") || "").trim();
    const psku = String(col(r, "producto_sku") || "").trim();
    const key = pid || psku;
    if (!key) continue;
    if (!imagesByProduct.has(key)) imagesByProduct.set(key, []);
    imagesByProduct.get(key)!.push(r);
  }
  const variantsByProduct = new Map<string, Record<string, unknown>[]>();
  for (const r of variantsSheet.rows) {
    const pid = String(col(r, "producto_id") || "").trim();
    const psku = String(col(r, "producto_sku") || "").trim();
    const key = pid || psku;
    if (!key) continue;
    if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
    variantsByProduct.get(key)!.push(r);
  }

  // Parse products
  const parsed: { row: Record<string, unknown>; idx: number; data: Record<string, unknown>; existing: any; errors: string[]; idRaw: string; skuRaw: string }[] = [];
  for (let i = 0; i < productsSheet.rows.length; i++) {
    const r = productsSheet.rows[i];
    const errors: string[] = [];
    const name = String(col(r, "nombre", "name") || "").trim();
    if (!name) { errors.push("Falta el nombre"); parsed.push({ row: r, idx: i + 2, data: {}, existing: null, errors, idRaw: "", skuRaw: "" }); continue; }
    const price = numVal(col(r, "precio", "price"));
    if (price == null || price < 0) { errors.push("Precio inválido"); parsed.push({ row: r, idx: i + 2, data: {}, existing: null, errors, idRaw: "", skuRaw: "" }); continue; }

    const idRaw = String(col(r, "_id", "id") || "").trim();
    const skuRaw = String(col(r, "sku") || "").trim();
    let existing: any = null;
    if (idRaw && existingById.has(idRaw)) existing = existingById.get(idRaw);
    else if (skuRaw && existingBySku.has(skuRaw)) existing = existingBySku.get(skuRaw);
    else existing = existingByName.get(name.toLowerCase()) || null;

    const data: Record<string, unknown> = {
      name,
      price,
      sku: skuRaw || null,
      description: String(col(r, "descripcion", "description") || "").trim() || null,
      category: String(col(r, "categoria", "category") || "").trim() || "otras",
      type: String(col(r, "tipo", "type") || "").trim() || "product",
      promo_price: numVal(col(r, "precio_promo", "promo_price")),
      promo_only: boolVal(col(r, "promo_solo", "promo_only")) === true,
      currency: String(col(r, "moneda", "currency") || "").trim() || "ARS",
      available: boolVal(col(r, "disponible", "available")) !== false,
      featured_today: boolVal(col(r, "destacado_hoy", "featured_today")) === true,
      online_available: boolVal(col(r, "venta_online", "online_available")) !== false,
      requires_prep: boolVal(col(r, "requiere_preparacion", "requires_prep")) === true,
      cash_discount_excluded: boolVal(col(r, "excluido_descuento_efectivo", "cash_discount_excluded")) === true,
      stock_control: boolVal(col(r, "controlar_stock", "stock_control")) === true,
      stock: numVal(col(r, "stock")),
      stock_low_threshold: numVal(col(r, "umbral_bajo_stock", "stock_low_threshold")),
      cost_last: numVal(col(r, "costo_ultimo", "cost_last")),
      expires_at: String(col(r, "vencimiento", "expires_at") || "").trim() || null,
      unit: String(col(r, "unidad", "unit") || "").trim() || "unidad",
      pack_size: numVal(col(r, "pack_size")),
      count_pack: boolVal(col(r, "count_pack")) === true,
      package_price: numVal(col(r, "package_price")),
      weight_step_kg: numVal(col(r, "weight_step_kg")),
      weight_min_kg: numVal(col(r, "weight_min_kg")),
      has_variants: boolVal(col(r, "tiene_variantes", "has_variants")) === true,
      size_guide: String(col(r, "guia_talles", "size_guide") || "").trim() || null,
      is_combo: boolVal(col(r, "es_combo", "is_combo")) === true,
      combo_items_str: String(col(r, "combo_items", "combo_items_str") || "").trim(),
      scale_plu: String(col(r, "scale_plu") || "").trim() || null,
      image_url: String(col(r, "imagen_principal", "image_url") || "").trim() || null,
      supplier_name: String(col(r, "proveedor", "supplier_name") || "").trim() || null,
      margin_list_name: String(col(r, "lista_margen", "margin_list_name") || "").trim() || null,
    };

    parsed.push({ row: r, idx: i + 2, data, existing, errors, idRaw, skuRaw });
  }

  const newCount = parsed.filter((p) => !p.existing && p.errors.length === 0).length;
  const updateCount = parsed.filter((p) => p.existing && p.errors.length === 0).length;
  const errorCount = parsed.filter((p) => p.errors.length > 0).length;

  if (action === "analyze") {
    return NextResponse.json({
      action: "analyze",
      read: productsSheet.rows.length,
      valid: parsed.filter((p) => p.errors.length === 0).length,
      newCount,
      updateCount,
      errorCount,
      planLimit: plan.maxProducts,
      items: parsed.map((p) => ({
        row: p.idx,
        name: p.data.name || "(sin nombre)",
        price: p.data.price,
        category: p.data.category,
        sku: p.data.sku,
        status: p.errors.length > 0 ? "error" : p.existing ? "update" : "new",
        errors: p.errors,
        existingId: p.existing?.id || null,
      })),
    });
  }

  // action === "import"
  // Plan limit check
  const newNames = parsed.filter((p) => !p.existing && p.errors.length === 0).map((p) => String(p.data.name).toLowerCase());
  const totalAfter = existingProducts.length + newNames.length;
  if (plan.maxProducts != null && totalAfter > plan.maxProducts) {
    return NextResponse.json({ error: `Tu plan permite hasta ${plan.maxProducts} productos.`, code: "plan_limit" }, { status: 403 });
  }

  const result = await withTransaction(async (tx) => {
    const hasSku = await hasColumn(tx, "products", "sku");
    const hasCostLast = await hasColumn(tx, "products", "cost_last");
    const hasStockControl = await hasColumn(tx, "products", "stock_control");
    const hasStockLow = await hasColumn(tx, "products", "stock_low_threshold");
    const hasPromoOnly = await hasColumn(tx, "products", "promo_only");
    const hasOnlineAvail = await hasColumn(tx, "products", "online_available");
    const hasRequiresPrep = await hasColumn(tx, "products", "requires_prep");
    const hasCashExcl = await hasColumn(tx, "products", "cash_discount_excluded");
    const hasHasVariants = await hasColumn(tx, "products", "has_variants");
    const hasSizeGuide = await hasColumn(tx, "products", "size_guide");
    const hasCountPack = await hasColumn(tx, "products", "count_pack");
    const hasPackagePrice = await hasColumn(tx, "products", "package_price");
    const hasWeightStep = await hasColumn(tx, "products", "weight_step_kg");
    const hasWeightMin = await hasColumn(tx, "products", "weight_min_kg");
    const hasScalePlu = await hasColumn(tx, "products", "scale_plu");
    const hasMarginList = await hasColumn(tx, "products", "margin_list_id");
    const hasSupplier = await hasColumn(tx, "products", "supplier_id");
    const hasExpires = await hasColumn(tx, "products", "expires_at");
    const hasUnit = await hasColumn(tx, "products", "unit");
    const hasPackSize = await hasColumn(tx, "products", "pack_size");
    const hasFeatured = await hasColumn(tx, "products", "featured_today");
    const hasComboItems = await hasColumn(tx, "products", "combo_items");
    const hasImage = await hasColumn(tx, "products", "image_url");

    // Categorías existentes
    const existingCats = await tx.query<{ name: string }>(`SELECT name FROM vendor_categories WHERE vendor_id = $1`, [vendor.id]);
    const catSet = new Set(existingCats.map((c) => c.name.trim().toLowerCase()));
    const neededCats = new Set<string>();
    for (const p of parsed) {
      if (p.errors.length > 0) continue;
      const cat = String(p.data.category || "otras").trim();
      if (cat && !catSet.has(cat.toLowerCase())) neededCats.add(cat);
    }
    for (const cname of neededCats) {
      const pos = await tx.queryOne<{ m: number }>(`SELECT count(*)::int AS m FROM vendor_categories WHERE vendor_id = $1`, [vendor.id]);
      await tx.queryVoid(`INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3)`, [vendor.id, cname, pos?.m ?? 0]);
    }

    // Proveedores
    const existingSuppliers = await tx.query<{ id: string; name: string }>(`SELECT id, name FROM suppliers WHERE vendor_id = $1`, [vendor.id]).catch(() => []);
    const supplierByName = new Map(existingSuppliers.map((s: any) => [String(s.name).trim().toLowerCase(), s.id]));
    const marginLists = await tx.query<{ id: string; name: string }>(`SELECT id, name FROM margin_lists WHERE vendor_id = $1`, [vendor.id]).catch(() => []);
    const marginListByName = new Map(marginLists.map((m: any) => [String(m.name).trim().toLowerCase(), m.id]));

    let imported = 0;
    let updated = 0;

    for (const p of parsed) {
      if (p.errors.length > 0) continue;
      const d = p.data;
      const name = String(d.name);
      const price = Number(d.price);

      // Resolve supplier
      let supplierId: string | null = null;
      if (d.supplier_name && hasSupplier) {
        const sname = String(d.supplier_name).trim().toLowerCase();
        if (supplierByName.has(sname)) {
          supplierId = supplierByName.get(sname) as string;
        } else if (sname) {
          const rows = await tx.query<{ id: string }>(`INSERT INTO suppliers (vendor_id, name) VALUES ($1, $2) RETURNING id`, [vendor.id, d.supplier_name]);
          supplierId = rows[0]?.id ?? null;
          if (supplierId) supplierByName.set(sname, supplierId);
        }
      }

      // Resolve margin list
      let marginListId: string | null = null;
      if (d.margin_list_name && hasMarginList) {
        marginListId = (marginListByName.get(String(d.margin_list_name).trim().toLowerCase()) as string) || null;
      }

      // Build update/insert
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      function addField(col: string, val: unknown, exists: boolean) {
        if (!exists) return;
        fields.push(`${col} = $${idx++}`);
        values.push(val);
      }

      if (p.existing) {
        // UPDATE
        addField("price", price, true);
        addField("category", d.category, true);
        addField("description", d.description, true);
        addField("available", d.available, true);
        addField("featured_today", d.featured_today, hasFeatured);
        addField("online_available", d.online_available, hasOnlineAvail);
        addField("requires_prep", d.requires_prep, hasRequiresPrep);
        addField("cash_discount_excluded", d.cash_discount_excluded, hasCashExcl);
        addField("stock_control", d.stock_control, hasStockControl);
        addField("stock", d.stock, hasStockControl);
        addField("stock_low_threshold", d.stock_low_threshold, hasStockLow);
        if (hasCostLast && d.cost_last != null) addField("cost_last", d.cost_last, true);
        addField("expires_at", d.expires_at, hasExpires);
        addField("unit", d.unit, hasUnit);
        addField("pack_size", d.pack_size, hasPackSize);
        addField("count_pack", d.count_pack, hasCountPack);
        addField("package_price", d.package_price, hasPackagePrice);
        addField("weight_step_kg", d.weight_step_kg, hasWeightStep);
        addField("weight_min_kg", d.weight_min_kg, hasWeightMin);
        addField("has_variants", d.has_variants, hasHasVariants);
        addField("size_guide", d.size_guide, hasSizeGuide);
        addField("scale_plu", d.scale_plu, hasScalePlu);
        addField("supplier_id", supplierId, hasSupplier);
        addField("margin_list_id", marginListId, hasMarginList);
        addField("image_url", d.image_url, hasImage);
        if (hasSku && d.sku) addField("sku", d.sku, true);
        if (hasPromoOnly) addField("promo_only", d.promo_only, true);
        addField("promo_price", d.promo_price, true);
        if (hasComboItems && d.is_combo) {
          // combo_items handled separately below
        }

        if (fields.length > 0) {
          values.push(p.existing.id);
          await tx.queryVoid(`UPDATE products SET ${fields.join(", ")} WHERE id = $${idx}`, values);
        }
        updated++;
      } else {
        // INSERT
        const cols = ["vendor_id", "name", "description", "price", "currency", "category", "neighborhood", "type", "available", "featured_today"];
        const vals: unknown[] = [vendor.id, name, d.description, price, d.currency, d.category, fullVendor?.neighborhood || null, d.type, d.available, d.featured_today];
        // Add optional columns
        const extraCols: [string, unknown, boolean][] = [
          ["sku", d.sku, hasSku],
          ["stock", d.stock, hasStockControl],
          ["stock_control", d.stock_control, hasStockControl],
          ["stock_low_threshold", d.stock_low_threshold, hasStockLow],
          ["cost_last", d.cost_last, hasCostLast],
          ["expires_at", d.expires_at, hasExpires],
          ["unit", d.unit, hasUnit],
          ["pack_size", d.pack_size, hasPackSize],
          ["count_pack", d.count_pack, hasCountPack],
          ["package_price", d.package_price, hasPackagePrice],
          ["weight_step_kg", d.weight_step_kg, hasWeightStep],
          ["weight_min_kg", d.weight_min_kg, hasWeightMin],
          ["has_variants", d.has_variants, hasHasVariants],
          ["size_guide", d.size_guide, hasSizeGuide],
          ["scale_plu", d.scale_plu, hasScalePlu],
          ["supplier_id", supplierId, hasSupplier],
          ["margin_list_id", marginListId, hasMarginList],
          ["image_url", d.image_url, hasImage],
          ["online_available", d.online_available, hasOnlineAvail],
          ["requires_prep", d.requires_prep, hasRequiresPrep],
          ["cash_discount_excluded", d.cash_discount_excluded, hasCashExcl],
          ["promo_only", d.promo_only, hasPromoOnly],
          ["promo_price", d.promo_price, true],
        ];
        for (const [col, val, exists] of extraCols) {
          if (exists) { cols.push(col); vals.push(val); }
        }
        const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
        const rows = await tx.query<{ id: string }>(`INSERT INTO products (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`, vals);
        const newId = rows[0]?.id;
        if (newId && d.sku && hasSku) {
          await tx.queryVoid(`UPDATE products SET sku = $1 WHERE id = $2`, [d.sku, newId]);
        }
        p.existing = { id: newId };
        imported++;
      }

      // Variantes (si la hoja tiene filas para este producto)
      const productId = p.existing.id;
      const variantRows = variantsByProduct.get(p.idRaw || p.skuRaw || name) || variantsByProduct.get(productId) || [];
      if (variantRows.length > 0 && (await hasTable(tx, "product_variants"))) {
        // Upsert variants by (color, talle)
        for (const vr of variantRows) {
          const color = String(col(vr as any, "color") || "").trim();
          const talle = String(col(vr as any, "talle") || "").trim();
          const vPrice = numVal(col(vr as any, "precio", "price"));
          const vPromo = numVal(col(vr as any, "promo"));
          const vStock = numVal(col(vr as any, "stock"));
          const vSku = String(col(vr as any, "sku") || "").trim() || null;
          if (vPrice == null) continue;
          const existingVar = await tx.queryOne<{ id: string }>(
            `SELECT id FROM product_variants WHERE product_id = $1 AND color = $2 AND talle = $3`,
            [productId, color, talle]
          );
          if (existingVar) {
            await tx.queryVoid(
              `UPDATE product_variants SET price = $1, promo = $2, stock = $3, sku = $4 WHERE id = $5`,
              [vPrice, vPromo, vStock ?? 0, vSku, existingVar.id]
            );
          } else {
            await tx.queryVoid(
              `INSERT INTO product_variants (product_id, color, talle, price, promo, stock, sku) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [productId, color, talle, vPrice, vPromo, vStock ?? 0, vSku]
            );
          }
        }
        if (hasHasVariants) {
          await tx.queryVoid(`UPDATE products SET has_variants = true WHERE id = $1`, [productId]);
        }
      }

      // Modificadores (si la hoja tiene filas para este producto)
      const modRows = modifiersByProduct.get(p.idRaw || p.skuRaw || name) || modifiersByProduct.get(productId) || [];
      if (modRows.length > 0 && (await hasTable(tx, "modifier_groups"))) {
        for (const mr of modRows) {
          const groupName = String(col(mr as any, "grupo", "group_name") || "Opciones").trim();
          let options: { label: string; price_mod: number }[] = [];
          try {
            const optsRaw = col(mr as any, "opciones", "options");
            if (typeof optsRaw === "string" && optsRaw.trim()) {
              const parsed = JSON.parse(optsRaw);
              if (Array.isArray(parsed)) {
                options = parsed.map((o: any) => ({ label: String(o.label || o.desc || "").trim(), price_mod: Number(o.price_mod || o.price || 0) })).filter((o) => o.label);
              }
            }
          } catch { /* skip */ }
          if (options.length === 0) continue;
          const required = col(mr as any, "obligatorio", "required") === true || col(mr as any, "obligatorio", "required") === "true";
          const maxSel = Number(col(mr as any, "max_selecciones", "max_selections")) || 1;
          const isVariant = col(mr as any, "es_variante", "is_variant") === true || col(mr as any, "es_variante", "is_variant") === "true";
          // Buscar o crear el grupo
          let group = await tx.queryOne<{ id: string }>(
            `SELECT id FROM modifier_groups WHERE vendor_id = $1 AND group_name = $2 LIMIT 1`,
            [vendor.id, groupName]
          );
          if (!group) {
            group = await (tx.query<{ id: string }>(
              `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
              [vendor.id, groupName, JSON.stringify(options), required, maxSel, isVariant]
            )).then((r) => r[0]);
          } else {
            await tx.queryVoid(
              `UPDATE modifier_groups SET options = $1, required = $2, max_selections = $3, is_variant = $4 WHERE id = $5`,
              [JSON.stringify(options), required, maxSel, isVariant, group.id]
            );
          }
          if (group?.id) {
            await tx.queryVoid(
              `INSERT INTO product_modifier_links (group_id, product_id, position) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
              [group.id, productId]
            );
          }
        }
      }

      // Imágenes (si la hoja tiene filas para este producto)
      const imgRows = imagesByProduct.get(p.idRaw || p.skuRaw || name) || imagesByProduct.get(productId) || [];
      if (imgRows.length > 0 && (await hasTable(tx, "product_images"))) {
        for (const ir of imgRows) {
          const url = String(col(ir as any, "url", "image_url") || "").trim();
          if (!url) continue;
          const color = String(col(ir as any, "color") || "").trim() || null;
          const pos = Number(col(ir as any, "posicion", "position")) || 0;
          await tx.queryVoid(
            `INSERT INTO product_images (product_id, image_url, color, position) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [productId, url, color, pos]
          );
        }
      }

      // Combo items (del campo combo_items_str en Productos)
      const comboStr = String(d.combo_items_str || "").trim();
      if (comboStr && (await hasColumn(tx, "products", "combo_items"))) {
        const items = comboStr.split(",").map((part) => {
          const [pid, qty] = part.split(":");
          return { product_id: pid?.trim(), qty: Number(qty) || 1 };
        }).filter((c) => c.product_id);
        if (items.length > 0) {
          await tx.queryVoid(`UPDATE products SET combo_items = $1 WHERE id = $2`, [JSON.stringify(items), productId]);
        }
      }
    }

    return { imported, updated };
  });

  return NextResponse.json({ action: "import", imported: result.imported, updated: result.updated });
}
