import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const vendorId = vendor.id;

  // Cargar todos los datos en paralelo
  const [
    products,
    variants,
    modifiers,
    productImages,
    categories,
    marginLists,
    suppliers,
  ] = await Promise.all([
    queryMany<any>(`SELECT * FROM products WHERE vendor_id = $1 ORDER BY created_at`, [vendorId]),
    queryMany<any>(`SELECT * FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE vendor_id = $1) ORDER BY position`, [vendorId]).catch(() => []),
    queryMany<any>(`SELECT mg.*, pml.product_id FROM modifier_groups mg LEFT JOIN product_modifier_links pml ON pml.group_id = mg.id WHERE mg.vendor_id = $1`, [vendorId]).catch(() => []),
    queryMany<any>(`SELECT * FROM product_images WHERE product_id IN (SELECT id FROM products WHERE vendor_id = $1) ORDER BY position`, [vendorId]).catch(() => []),
    queryMany<any>(`SELECT * FROM vendor_categories WHERE vendor_id = $1 ORDER BY position`, [vendorId]).catch(() => []),
    queryMany<any>(`SELECT * FROM margin_lists WHERE vendor_id = $1`, [vendorId]).catch(() => []),
    queryMany<any>(`SELECT * FROM suppliers WHERE vendor_id = $1`, [vendorId]).catch(() => []),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal 659";
  wb.created = new Date();

  // --- Hoja: Instrucciones ---
  const wsInstr = wb.addWorksheet("Instrucciones");
  wsInstr.columns = [{ width: 100 }];
  const instrLines = [
    "INSTRUCCIONES DE USO",
    "",
    "1. La hoja 'Productos' es la principal. Cada fila = un producto.",
    "2. La columna '_id' es el identificador interno. NO la borres ni la modifiques: se usa para actualizar productos existentes.",
    "3. Si no tenés '_id' (producto nuevo), se crea uno nuevo. Si tenés '_id' o 'sku' que coincide, se actualiza.",
    "4. Las hojas 'Variantes', 'Modificadores', 'Imágenes', 'Combos', 'Volumen' y 'Recetas' son opcionales: solo se procesan si tienen filas.",
    "5. Si una hoja está vacía para un producto, no se modifica esa relación (no se borra nada).",
    "6. Para borrar una variante/modificador/imagen/combo, usá el panel web (no desde el Excel).",
    "7. Las columnas con prefijo '_' son internas (no editar).",
    "8. Las imágenes se referencian por URL (no se suben archivos).",
    "9. Los precios son en ARS. Usá punto para decimales (ej: 4500.50).",
    "10. Categorías y proveedores que no existan se crean automáticamente al importar.",
    "",
    "CLAVES DE MATCHING (en orden):",
    "  1. _id (identificador interno)",
    "  2. sku (código del producto)",
    "  3. nombre (normalizado, sin tildes, en minúsculas)",
    "",
    "HOJAS:",
    "  - Productos: datos principales del producto",
    "  - Variantes: color × talle (solo moda)",
    "  - Modificadores: grupos de opciones (ej: 'Tamaño: Chico/Mediano/Grande')",
    "  - Imágenes: galería de fotos extra",
    "  - Combos: componentes de combos armables",
    "  - Volumen: precios por volumen (llevá N y pagá X)",
    "  - Recetas: escandallo (ingredientes por producto)",
    "  - Categorías: referencia (no editar, se crea automáticamente)",
    "  - Listas_Margen: referencia (no editar)",
  ];
  instrLines.forEach((line) => wsInstr.addRow([line]));

  // --- Hoja: Productos ---
  const wsProd = wb.addWorksheet("Productos");
  const prodColumns = [
    { header: "_id", key: "_id", width: 38 },
    { header: "sku", key: "sku", width: 16 },
    { header: "nombre", key: "name", width: 30 },
    { header: "descripcion", key: "description", width: 40 },
    { header: "categoria", key: "category", width: 18 },
    { header: "tipo", key: "type", width: 10 },
    { header: "precio", key: "price", width: 12 },
    { header: "precio_promo", key: "promo_price", width: 12 },
    { header: "promo_solo", key: "promo_only", width: 10 },
    { header: "moneda", key: "currency", width: 8 },
    { header: "disponible", key: "available", width: 11 },
    { header: "destacado_hoy", key: "featured_today", width: 12 },
    { header: "venta_online", key: "online_available", width: 12 },
    { header: "requiere_preparacion", key: "requires_prep", width: 14 },
    { header: "excluido_descuento_efectivo", key: "cash_discount_excluded", width: 16 },
    { header: "controlar_stock", key: "stock_control", width: 12 },
    { header: "stock", key: "stock", width: 8 },
    { header: "umbral_bajo_stock", key: "stock_low_threshold", width: 12 },
    { header: "costo_ultimo", key: "cost_last", width: 12 },
    { header: "costo_promedio", key: "cost_avg", width: 12 },
    { header: "proveedor", key: "supplier_name", width: 20 },
    { header: "vencimiento", key: "expires_at", width: 12 },
    { header: "lista_margen", key: "margin_list_name", width: 20 },
    { header: "unidad", key: "unit", width: 10 },
    { header: "pack_size", key: "pack_size", width: 10 },
    { header: "count_pack", key: "count_pack", width: 10 },
    { header: "package_price", key: "package_price", width: 12 },
    { header: "weight_step_kg", key: "weight_step_kg", width: 12 },
    { header: "weight_min_kg", key: "weight_min_kg", width: 12 },
    { header: "tiene_variantes", key: "has_variants", width: 12 },
    { header: "guia_talles", key: "size_guide", width: 30 },
    { header: "es_combo", key: "is_combo", width: 10 },
    { header: "combo_items", key: "combo_items_str", width: 30 },
    { header: "scale_plu", key: "scale_plu", width: 12 },
    { header: "imagen_principal", key: "image_url", width: 40 },
  ];
  wsProd.columns = prodColumns;

  const supplierMap = new Map((suppliers || []).map((s: any) => [s.id, s.name]));
  const marginListMap = new Map((marginLists || []).map((m: any) => [m.id, m.name]));

  for (const p of products || []) {
    const comboItems = Array.isArray(p.combo_items) ? p.combo_items : (typeof p.combo_items === "string" ? JSON.parse(p.combo_items || "[]") : []);
    const comboStr = comboItems.map((c: any) => `${c.product_id}:${c.qty || 1}`).join(",");
    wsProd.addRow({
      _id: p.id,
      sku: p.sku || "",
      name: p.name,
      description: p.description || "",
      category: p.category || "",
      type: p.type || "product",
      price: p.price,
      promo_price: p.promo_price,
      promo_only: p.promo_only === true,
      currency: p.currency || "ARS",
      available: p.available !== false,
      featured_today: p.featured_today === true,
      online_available: p.online_available !== false,
      requires_prep: p.requires_prep === true,
      cash_discount_excluded: p.cash_discount_excluded === true,
      stock_control: p.stock_control === true,
      stock: p.stock,
      stock_low_threshold: p.stock_low_threshold,
      cost_last: p.cost_last,
      cost_avg: p.cost_avg,
      supplier_name: supplierMap.get(p.supplier_id) || "",
      expires_at: p.expires_at ? String(p.expires_at).slice(0, 10) : "",
      margin_list_name: marginListMap.get(p.margin_list_id) || "",
      unit: p.unit || "unidad",
      pack_size: p.pack_size,
      count_pack: p.count_pack === true,
      package_price: p.package_price,
      weight_step_kg: p.weight_step_kg,
      weight_min_kg: p.weight_min_kg,
      has_variants: p.has_variants === true,
      size_guide: p.size_guide || "",
      is_combo: comboItems.length > 0,
      combo_items_str: comboStr,
      scale_plu: p.scale_plu || "",
      image_url: p.image_url || "",
    });
  }

  // Estilo header
  const headerStyle = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF2496C6" } } };
  wsProd.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });
  wsProd.getRow(1).height = 20;

  // --- Hoja: Variantes ---
  const wsVar = wb.addWorksheet("Variantes");
  wsVar.columns = [
    { header: "producto_id", key: "product_id", width: 38 },
    { header: "producto_sku", key: "product_sku", width: 16 },
    { header: "color", key: "color", width: 16 },
    { header: "talle", key: "talle", width: 10 },
    { header: "precio", key: "price", width: 12 },
    { header: "promo", key: "promo", width: 12 },
    { header: "stock", key: "stock", width: 8 },
    { header: "sku", key: "sku", width: 16 },
    { header: "posicion", key: "position", width: 10 },
  ];
  const productSkuMap = new Map((products || []).map((p: any) => [p.id, p.sku || ""]));
  for (const v of variants || []) {
    wsVar.addRow({
      product_id: v.product_id,
      product_sku: productSkuMap.get(v.product_id) || "",
      color: v.color || "",
      talle: v.talle || "",
      price: v.price,
      promo: v.promo,
      stock: v.stock,
      sku: v.sku || "",
      position: v.position || 0,
    });
  }
  wsVar.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  // --- Hoja: Modificadores ---
  const wsMod = wb.addWorksheet("Modificadores");
  wsMod.columns = [
    { header: "producto_id", key: "product_id", width: 38 },
    { header: "grupo", key: "group_name", width: 20 },
    { header: "opciones", key: "options", width: 50 },
    { header: "obligatorio", key: "required", width: 12 },
    { header: "max_selecciones", key: "max_selections", width: 14 },
    { header: "es_variante", key: "is_variant", width: 12 },
  ];
  for (const m of modifiers || []) {
    wsMod.addRow({
      product_id: m.product_id || "",
      group_name: m.group_name || "",
      options: JSON.stringify(m.options || []),
      required: m.required === true,
      max_selections: m.max_selections || 1,
      is_variant: m.is_variant === true,
    });
  }
  wsMod.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  // --- Hoja: Imágenes ---
  const wsImg = wb.addWorksheet("Imagenes");
  wsImg.columns = [
    { header: "producto_id", key: "product_id", width: 38 },
    { header: "url", key: "image_url", width: 50 },
    { header: "color", key: "color", width: 16 },
    { header: "posicion", key: "position", width: 10 },
  ];
  for (const img of productImages || []) {
    wsImg.addRow({
      product_id: img.product_id,
      image_url: img.image_url || "",
      color: img.color || "",
      position: img.position || 0,
    });
  }
  wsImg.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  // --- Hoja: Combos ---
  const wsCombo = wb.addWorksheet("Combos");
  wsCombo.columns = [
    { header: "combo_id", key: "combo_id", width: 38 },
    { header: "combo_sku", key: "combo_sku", width: 16 },
    { header: "componente_id", key: "component_id", width: 38 },
    { header: "componente_sku", key: "component_sku", width: 16 },
    { header: "cantidad", key: "qty", width: 10 },
  ];
  const productById = new Map((products || []).map((p: any) => [p.id, p]));
  for (const p of products || []) {
    const items = Array.isArray(p.combo_items) ? p.combo_items : (typeof p.combo_items === "string" ? JSON.parse(p.combo_items || "[]") : []);
    for (const c of items) {
      const comp = productById.get(c.product_id);
      wsCombo.addRow({
        combo_id: p.id,
        combo_sku: p.sku || "",
        component_id: c.product_id,
        component_sku: comp?.sku || "",
        qty: c.qty || 1,
      });
    }
  }
  wsCombo.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  // --- Hoja: Categorías ---
  const wsCat = wb.addWorksheet("Categorias");
  wsCat.columns = [
    { header: "nombre", key: "name", width: 24 },
    { header: "posicion", key: "position", width: 10 },
  ];
  for (const c of categories || []) {
    wsCat.addRow({ name: c.name, position: c.position || 0 });
  }
  wsCat.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  // --- Hoja: Listas_Margen ---
  const wsML = wb.addWorksheet("Listas_Margen");
  wsML.columns = [
    { header: "_id", key: "id", width: 38 },
    { header: "nombre", key: "name", width: 24 },
    { header: "regla", key: "rule", width: 12 },
    { header: "porcentaje", key: "pct", width: 12 },
  ];
  for (const m of marginLists || []) {
    wsML.addRow({ id: m.id, name: m.name, rule: m.rule, pct: m.pct });
  }
  wsML.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `catalogo-${vendor.id}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
