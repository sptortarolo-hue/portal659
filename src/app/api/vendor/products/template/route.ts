import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Portal 659";
  wb.created = new Date();

  // Instrucciones
  const wsInstr = wb.addWorksheet("Instrucciones");
  wsInstr.columns = [{ width: 100 }];
  [
    "PLANTILLA DE IMPORTACIÓN DE PRODUCTOS",
    "",
    "Completá la hoja 'Productos' con tus productos. Las demás hojas son opcionales.",
    "Borrá la fila de ejemplo antes de importar.",
    "",
    "Columnas obligatorias: nombre, precio.",
    "Columna _id: dejala vacía para productos nuevos.",
    "Columna sku: código único del producto (opcional pero recomendado).",
    "",
    "Ver la hoja 'Productos' para los nombres exactos de columnas.",
  ].forEach((l) => wsInstr.addRow([l]));

  const wsProd = wb.addWorksheet("Productos");
  wsProd.columns = [
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

  // Fila de ejemplo
  wsProd.addRow({
    _id: "",
    sku: "EJEMPLO-001",
    name: "Producto de ejemplo",
    description: "Descripción del producto",
    category: "otras",
    type: "product",
    price: 1000,
    promo_price: null,
    promo_only: false,
    currency: "ARS",
    available: true,
    featured_today: false,
    online_available: true,
    requires_prep: false,
    cash_discount_excluded: false,
    stock_control: false,
    stock: 0,
    stock_low_threshold: 5,
    cost_last: null,
    supplier_name: "",
    expires_at: "",
    margin_list_name: "",
    unit: "unidad",
    pack_size: null,
    count_pack: false,
    package_price: null,
    weight_step_kg: null,
    weight_min_kg: null,
    has_variants: false,
    size_guide: "",
    is_combo: false,
    combo_items_str: "",
    scale_plu: "",
    image_url: "",
  });

  const headerStyle = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF2496C6" } } };
  wsProd.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });

  // Hojas vacías de relaciones
  const emptySheets = ["Variantes", "Modificadores", "Imagenes", "Combos", "Categorias", "Listas_Margen"];
  const colDefs: Record<string, any[]> = {
    Variantes: [
      { header: "producto_id", key: "product_id", width: 38 },
      { header: "producto_sku", key: "product_sku", width: 16 },
      { header: "color", key: "color", width: 16 },
      { header: "talle", key: "talle", width: 10 },
      { header: "precio", key: "price", width: 12 },
      { header: "promo", key: "promo", width: 12 },
      { header: "stock", key: "stock", width: 8 },
      { header: "sku", key: "sku", width: 16 },
      { header: "posicion", key: "position", width: 10 },
    ],
    Modificadores: [
      { header: "producto_id", key: "product_id", width: 38 },
      { header: "grupo", key: "group_name", width: 20 },
      { header: "opciones", key: "options", width: 50 },
      { header: "obligatorio", key: "required", width: 12 },
      { header: "max_selecciones", key: "max_selections", width: 14 },
      { header: "es_variante", key: "is_variant", width: 12 },
    ],
    Imagenes: [
      { header: "producto_id", key: "product_id", width: 38 },
      { header: "url", key: "image_url", width: 50 },
      { header: "color", key: "color", width: 16 },
      { header: "posicion", key: "position", width: 10 },
    ],
    Combos: [
      { header: "combo_id", key: "combo_id", width: 38 },
      { header: "combo_sku", key: "combo_sku", width: 16 },
      { header: "componente_id", key: "component_id", width: 38 },
      { header: "componente_sku", key: "component_sku", width: 16 },
      { header: "cantidad", key: "qty", width: 10 },
    ],
    Categorias: [
      { header: "nombre", key: "name", width: 24 },
      { header: "posicion", key: "position", width: 10 },
    ],
    Listas_Margen: [
      { header: "_id", key: "id", width: 38 },
      { header: "nombre", key: "name", width: 24 },
      { header: "regla", key: "rule", width: 12 },
      { header: "porcentaje", key: "pct", width: 12 },
    ],
  };
  for (const name of emptySheets) {
    const ws = wb.addWorksheet(name);
    ws.columns = colDefs[name];
    ws.getRow(1).eachCell((cell) => { Object.assign(cell, headerStyle); });
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="plantilla-catalogo.xlsx"`,
    },
  });
}
