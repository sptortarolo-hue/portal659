import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction, type Tx } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { cleanMenu } from "@/lib/llm";
import { unitFactor } from "@/lib/costing";
import {
  parseFudoSheets,
  normalizeUnit,
  inferBaseUnit,
  normName,
  cellText,
  type FudoIngredient,
  type FudoRecipeLine,
  type FudoGroupDef,
  type FudoGroupOption,
  type FudoAssociation,
} from "@/lib/fudo-import";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import type { Plan, Vendor } from "@/types/database";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB (el xlsx de FUDO con recetas puede ser pesado)
const MAX_WA_SIZE = 30 * 1024 * 1024; // 30 MB (el CSV WA trae fotos en base64)
const ALLOWED_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];
const WA_MIME = [
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

/** Extensión "WhatsApp Catalogue Exporter":
 * https://chromewebstore.google.com/detail/beambfgmpbbncelafdodhppkjgnnabgf */
export const WA_EXTENSION_URL =
  "https://chromewebstore.google.com/detail/beambfgmpbbncelafdodhppkjgnnabgf";

export const runtime = "nodejs"; // exceljs no corre en edge

type CleanedItem = {
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
  group?: string | null;
  sku?: string | null;
  modifiers?: { desc: string; price_mod: number }[];
  // Extras FUDO (opcionales, con defaults sanos si no vienen).
  available?: boolean;
  featured?: boolean;
  cost?: number | null;
  supplier?: string;
  stock?: number | null;
  stockMin?: number | null;
  stockControl?: boolean;
};

// Headers reconocidos por campo (para detectar la fila de encabezado y mapear)
const HEADER_ALIASES: Record<"name" | "price" | "category" | "description" | "sku", string[]> = {
  name: ["nombre", "plato", "producto", "item", "articulo", "comida", "menu", "name", "descripcion del plato"],
  price: ["precio", "price", "valor", "p", "$", "precio$"],
  category: ["categoria", "categoría", "seccion", "sección", "rubro", "cat", "tipo", "category"],
  description: ["descripcion", "descripción", "desc", "detalle", "description"],
  sku: ["sku", "codigo", "código", "codigobarras", "ean", "ean13", "barcode"],
};

function normKey(k: string): string {
  return String(k)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, "")
    .replace(/[^\p{L}\p{N}$]+/gu, "");
}

function fieldForHeader(raw: string): keyof typeof HEADER_ALIASES | null {
  const k = normKey(raw);
  if (!k) return null;
  // SKU antes que genéricos ("codigo" no debe caer en otra cosa).
  if (k === "sku" || k === "ean" || k === "ean13" || k === "barcode" || k === "codigo" || k === "codigodebarras" || k === "codigobarras") return "sku";
  for (const field of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
    if (field === "sku") continue;
    const aliases = HEADER_ALIASES[field].map(normKey);
    if (aliases.includes(k)) return field;
    if (field === "name" && (k.includes("nombre") || k.includes("plato") || k.includes("producto"))) return field;
    if (field === "price" && (k.includes("precio") || k === "$")) return field;
    if (field === "category" && (k.includes("categor") || k.includes("seccion") || k.includes("rubro"))) return field;
    if (field === "description" && (k.includes("descripc") || k.includes("detalle"))) return field;
  }
  return null;
}

/**
 * Detecta un encabezado de modificante: "Modificante 1 descripcion" / "Modificante 1 precio".
 * Devuelve la key (`mod1_desc`, `mod1_price`) o null.
 */
function modifierKeyForHeader(raw: string): string | null {
  const k = normKey(raw);
  if (!k) return null;
  const m = k.match(/^modificante(\d+)(desc|precio|price|descripcion)$/);
  if (!m) return null;
  const n = m[1];
  const kind = m[2];
  if (kind === "desc" || kind === "descripcion") return `mod${n}_desc`;
  return `mod${n}_price`;
}

/**
 * Detecta un encabezado de grupo de modificantes: "Grupo".
 * Devuelve la key "grupo" o null.
 */
function groupKeyForHeader(raw: string): "grupo" | null {
  const k = normKey(raw);
  if (!k) return null;
  if (k === "grupo" || k === "grupomodificantes" || k === "grupodeopciones" || k === "grupomodificador") return "grupo";
  return null;
}

/**
 * Lee la primera hoja como array de arrays y detecta la fila de encabezado
 * (la primera donde aparezcan headers de nombre + precio). Devuelve objetos
 * `{ header: valor }` para las filas de datos que siguen.
 */
async function parseWorkbook(buf: Buffer): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    // cellText: los headers de FUDO vienen como rich-text (negrita, `*`);
    // String() directo daría "[object Object]" y rompería el mapeo.
    rows.push((row.values as unknown[]).slice(1).map((v) => cellText(v)));
  });

  // detectar fila de encabezado
  let headerRowIdx = -1;
  let headerMap: (number | string)[] = []; // index de columna -> campo (1-4) o key de modificante
  for (let i = 0; i < rows.length && headerRowIdx < 0; i++) {
    const fields: (number | string)[] = [];
    let hasName = false;
    let hasPrice = false;
    for (let c = 0; c < rows[i].length; c++) {
      // Columnas específicas (modificantes/grupo) se chequean antes que los
      // campos genéricos: "Modificante 1 Descripción" contiene "descriptción" y
      // "Modificante 1 Precio" contiene "precio" — si evaluamos fieldForHeader
      // primero, esas columnas terminan pisando el precio/descripción del plato.
      const groupKey = groupKeyForHeader(rows[i][c]);
      if (groupKey) {
        fields[c] = groupKey;
        continue;
      }
      const modKey = modifierKeyForHeader(rows[i][c]);
      if (modKey) {
        fields[c] = modKey;
        continue;
      }
      const field = fieldForHeader(rows[i][c]);
      if (field) {
        fields[c] = field === "name" ? 1 : field === "price" ? 2 : field === "category" ? 3 : field === "description" ? 4 : 5;
        if (field === "name") hasName = true;
        if (field === "price") hasPrice = true;
      }
    }
    if (hasName && hasPrice) {
      headerRowIdx = i;
      headerMap = fields;
      break;
    }
  }

  if (headerRowIdx < 0) {
    // sin header detectado: asumir fila 0 con headers y columnas nombre/precio/cat/desc
    return rows.slice(1).map((r) => {
      const obj: Record<string, unknown> = {};
      if (r[0] != null && r[0] !== "") obj["nombre"] = r[0];
      if (r[1] != null && r[1] !== "") obj["precio"] = r[1];
      if (r[2] != null && r[2] !== "") obj["categoria"] = r[2];
      if (r[3] != null && r[3] !== "") obj["descripcion"] = r[3];
      return obj;
    });
  }

  const headers = rows[headerRowIdx];
  const out: Record<string, unknown>[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const obj: Record<string, unknown> = {};
    let nonEmpty = false;
    for (let c = 0; c < rows[i].length; c++) {
      const val = rows[i][c];
      if (val != null && val !== "") nonEmpty = true;
      const field = headerMap[c];
      let key: string;
      if (typeof field === "number") {
        key = HEADER_ALIASES[(field === 1 ? "name" : field === 2 ? "price" : field === 3 ? "category" : field === 5 ? "sku" : "description") as keyof typeof HEADER_ALIASES][0];
      } else if (field) {
        key = field; // "mod1_desc", "mod1_price", ...
      } else {
        key = headers[c] || `col${c}`;
      }
      obj[key] = val;
    }
    if (nonEmpty) out.push(obj);
  }
  return out;
}

// ============ FUDO: lectura multi-hoja ============
// Lee TODAS las hojas como grillas de strings para el parser FUDO.
async function readAllSheets(buf: Buffer): Promise<{ name: string; rows: string[][] }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb.worksheets.map((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      rows.push((row.values as unknown[]).slice(1).map((v) => cellText(v)));
    });
    return { name: sheet.name || "hoja", rows };
  });
}

// ============ CSV de WhatsApp Catalogue Exporter ============
// Columnas: index,name,price,price_value,currency,description,product_link,image_url,image_data,raw_text
// La foto real viene en `image_data` (data URI base64); `image_url` suele ser
// `blob:https://web.whatsapp.com/...` (efímero, no descargable) y se ignora.

type WaRow = {
  index: string;
  name: string;
  price: number | null;
  description: string;
  imageData: string; // data URI o ""
};

function parseWaCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { q = false; }
      } else { cur += c; }
    } else if (c === '"') { q = true; }
    else if (c === ",") { out.push(cur); cur = ""; }
    else { cur += c; }
  }
  out.push(cur);
  return out;
}

function parseWaCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = parseWaCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = parseWaCsvLine(l);
    const o: Record<string, string> = {};
    header.forEach((h, j) => { o[h] = cells[j] ?? ""; });
    return o;
  });
}

function waPriceOf(r: Record<string, string>): number | null {
  const pv = Number(String(r.price_value || "").replace(/[^\d.-]/g, ""));
  if (Number.isFinite(pv) && pv > 0) return Math.round(pv);
  const s = String(r.price || "").replace(/[^\d.,]/g, "").trim();
  if (!s) return null;
  let norm = s;
  if (/,/.test(s)) norm = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, "");
  const n = Number(norm);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function waRowsOf(text: string): WaRow[] {
  return parseWaCsv(text).map((r) => ({
    index: (r.index || "").trim(),
    name: (r.name || "").replace(/\s+/g, " ").trim(),
    price: waPriceOf(r),
    description: (r.description || "").replace(/\s+/g, " ").trim(),
    imageData: r.image_data || "",
  }));
}

function waImageBuffer(dataUri: string): Buffer | null {
  const m = (dataUri || "").match(/^data:(image\/(jpeg|jpg|png|webp));base64,([\s\S]+)$/);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[3].replace(/\s+/g, ""), "base64");
    if (buf.length < 500) return null;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isWebp = buf.toString("ascii", 0, 4) === "RIFF";
    if (!isJpg && !isPng && !isWebp) return null;
    return buf;
  } catch { return null; }
}

async function waProcessImage(buf: Buffer): Promise<{ buf: Buffer; ext: string }> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(buf).metadata();
    const fmt = meta.format as string | undefined;
    if (fmt === "png" || fmt === "webp") {
      return { buf: await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).toFormat(fmt, { quality: 80 }).toBuffer(), ext: fmt };
    }
    if (fmt === "avif" || fmt === "gif") return { buf, ext: "jpg" };
    return { buf: await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer(), ext: "jpg" };
  } catch {
    return { buf, ext: "jpg" };
  }
}

// ============ FUDO: analyze ============
// Devuelve preview de productos + ingredientes + grupos + recetas en una sola respuesta.
async function analyzeFudo(
  vendorId: string,
  fudo: ReturnType<typeof parseFudoSheets>
) {
  const existingNames = await queryMany<{ name: string }>(
    `SELECT name FROM products WHERE vendor_id = $1`,
    [vendorId]
  );
  const existingSet = new Set(existingNames.map((p) => normName(p.name)));
  const existingSkus = await queryMany<{ sku: string }>(
    `SELECT sku FROM products WHERE vendor_id = $1 AND sku IS NOT NULL AND sku <> ''`,
    [vendorId]
  ).catch(() => []);
  const skuSet = new Set((existingSkus || []).map((p) => String(p.sku).trim()));

  const valid: CleanedItem[] = [];
  const invalid: { row: string; reason: string }[] = [...fudo.warnings];
  for (const p of fudo.products) {
    valid.push({
      name: p.name,
      price: p.price,
      category: p.category,
      description: p.description,
      group: p.group || "",
      sku: p.sku,
      modifiers: p.modifiers,
      available: p.available,
      featured: p.featured,
      cost: p.cost,
      supplier: p.supplier || "",
      stock: p.stock,
      stockMin: p.stockMin,
      stockControl: p.stockControl,
    });
  }

  // Ingredientes: validación liviana (nombre obligatorio).
  const ingredients: FudoIngredient[] = [];
  for (const ing of fudo.ingredients) {
    if (!ing.name.trim()) {
      invalid.push({ row: "(ingrediente sin nombre)", reason: "Falta el nombre" });
      continue;
    }
    ingredients.push({
      ...ing,
      name: ing.name.trim(),
      category: ing.category?.trim() || "general",
      unit: normalizeUnit(ing.unit),
    });
  }

  // Recetas: agrupar por plato para el resumen.
  const recipeDishes = new Set(fudo.recipeLines.map((l) => normName(l.dish)));
  // Grupos FUDO armados (asociación grupo→producto + composición).
  const optionsByGroup = new Map<string, FudoGroupOption[]>();
  for (const o of fudo.groupOptions) {
    const k = normName(o.group);
    if (!optionsByGroup.has(k)) optionsByGroup.set(k, []);
    optionsByGroup.get(k)!.push(o);
  }

  const isNewItem = (it: CleanedItem) => {
    const sku = typeof it.sku === "string" ? it.sku.trim() : "";
    if (sku && skuSet.has(sku)) return false;
    return !existingSet.has(normName(it.name));
  };
  const toImport = valid.filter((it) => isNewItem(it)).length;

  return NextResponse.json({
    action: "analyze",
    usedLlm: false,
    source: "fudo",
    sheets: fudo.sheetsFound,
    read: fudo.products.length,
    valid: valid.length,
    toImport,
    willUpdate: valid.length - toImport,
    invalid,
    items: valid.map((it) => ({
      name: it.name,
      price: it.price,
      category: it.category || "",
      description: it.description || "",
      group: it.group || "",
      modifiers: it.modifiers || [],
      sku: typeof it.sku === "string" ? it.sku.trim().slice(0, 64) : "",
      available: it.available !== false,
      featured: it.featured === true,
      cost: it.cost ?? null,
      stock: it.stock ?? null,
      stockMin: it.stockMin ?? null,
      stockControl: it.stockControl === true,
    })),
    fudo: {
      ingredients,
      ingredientCount: ingredients.length,
      groups: fudo.groups.map((g) => ({
        ...g,
        options: optionsByGroup.get(normName(g.name)) ?? [],
        linkedProducts: fudo.associations
          .filter((a) => normName(a.group) === normName(g.name))
          .map((a) => a.product),
      })),
      groupCount: fudo.groups.length,
      associations: fudo.associations,
      recipeLines: fudo.recipeLines as FudoRecipeLine[],
      recipeDishCount: recipeDishes.size,
      recipeLineCount: fudo.recipeLines.length,
    },
  });
}

// upsert tolerante de un proveedor por nombre. Null si la tabla no existe.
async function upsertSupplierTx(tx: Tx, vendorId: string, name: string): Promise<string | null> {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM suppliers WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [vendorId, clean]
  ).catch(() => null);
  if (existing?.id) return existing.id;
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO suppliers (vendor_id, name) VALUES ($1, $2) RETURNING id`,
    [vendorId, clean]
  ).catch(() => []);
  return rows[0]?.id ?? null;
}

// upsert tolerante de un insumo por nombre normalizado.
// - Crea con base_unit inferida de la unidad FUDO.
// - El costo FUDO viene por unidad de línea (ej. $/kg): se convierte a
//   costo por unidad BASE (ej. $/g) antes de guardar cost_per_unit.
// - Si ya existe, actualiza costo/merma (no pisa la base si ya tiene recetas).
// - Deja lista de precios del proveedor (tolerante a migrate-inventory.sql).
async function upsertIngredientTx(
  tx: Tx,
  vendorId: string,
  ing: { name: string; category: string; unit: string; cost: number | null; wastePct: number; supplier?: string }
): Promise<string | null> {
  const base = inferBaseUnit(ing.unit);
  const lineUnit = normalizeUnit(ing.unit);
  const factor = unitFactor(lineUnit, base) ?? 1;
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const costPerBase = ing.cost != null ? round4(ing.cost / factor) : null;
  const supplierId = ing.supplier ? await upsertSupplierTx(tx, vendorId, ing.supplier) : null;
  const existing = await tx.queryOne<{ id: string; base_unit: string }>(
    `SELECT id, base_unit FROM ingredients WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [vendorId, ing.name]
  ).catch(() => null);
  if (existing) {
    // Actualizar costo/merma/notas sin tocar base_unit (409 si está en uso).
    await tx.queryVoid(
      `UPDATE ingredients SET cost_per_unit = COALESCE($1, cost_per_unit), waste_pct = $2, notes = COALESCE(NULLIF(notes,''), $3) WHERE id = $4`,
      [costPerBase, ing.wastePct, `Importado de FUDO${ing.category ? ` · ${ing.category}` : ""}`, existing.id]
    ).catch(() => null);
    // Intentar guardar categoría si la columna existe (migración nueva).
    await tx.queryVoid(`UPDATE ingredients SET category = $1 WHERE id = $2`, [ing.category, existing.id]).catch(() => null);
    if (supplierId && ing.cost != null) {
      await tx.queryVoid(
        `INSERT INTO supplier_pricelists (supplier_id, vendor_id, ingredient_id, price, unit)
         SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM supplier_pricelists
           WHERE supplier_id = $1 AND ingredient_id = $3 AND price = $4 AND unit = $5)`,
        [supplierId, vendorId, existing.id, ing.cost, lineUnit]
      ).catch(() => null);
    }
    return existing.id;
  }
  try {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO ingredients (vendor_id, name, base_unit, cost_per_unit, waste_pct, notes, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [vendorId, ing.name, base, costPerBase ?? 0, ing.wastePct, `Importado de FUDO${ing.category ? ` · ${ing.category}` : ""}`, ing.category]
    );
    if (rows[0]?.id) {
      if (supplierId && ing.cost != null) {
        await tx.queryVoid(
          `INSERT INTO supplier_pricelists (supplier_id, vendor_id, ingredient_id, price, unit)
           SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM supplier_pricelists
             WHERE supplier_id = $1 AND ingredient_id = $3 AND price = $4 AND unit = $5)`,
          [supplierId, vendorId, rows[0].id, ing.cost, lineUnit]
        ).catch(() => null);
      }
      return rows[0].id;
    }
  } catch {
    // Sin columna category (migración pendiente): reintentar sin ella.
  }
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO ingredients (vendor_id, name, base_unit, cost_per_unit, waste_pct, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [vendorId, ing.name, base, costPerBase ?? 0, ing.wastePct, `Importado de FUDO${ing.category ? ` · ${ing.category}` : ""}`]
  ).catch(() => []);
  const newId = rows[0]?.id ?? null;
  if (newId && supplierId && ing.cost != null) {
    await tx.queryVoid(
      `INSERT INTO supplier_pricelists (supplier_id, vendor_id, ingredient_id, price, unit)
       SELECT $1, $2, $3, $4, $5 WHERE NOT EXISTS (SELECT 1 FROM supplier_pricelists
         WHERE supplier_id = $1 AND ingredient_id = $3 AND price = $4 AND unit = $5)`,
      [supplierId, vendorId, newId, ing.cost, lineUnit]
    ).catch(() => null);
  }
  return newId;
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const form = await request.formData();
  const action = (form.get("action") as string) || "analyze";

  // ============ FASE ANALYZE ============
  if (action === "analyze") {
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Subí un archivo .xlsx" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "El archivo supera los 10 MB" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Solo se admiten archivos .xlsx" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // ---- Camino FUDO: multi-hoja (productos + ingredientes + grupos + recetas) ----
    try {
      const sheets = await readAllSheets(buf);
      const fudo = parseFudoSheets(sheets);
      if (fudo.isFudo) {
        return await analyzeFudo(vendor.id, fudo);
      }
    } catch {
      // Si falla la lectura multi-hoja, se sigue con el parser clásico abajo.
    }

    let rows: Record<string, unknown>[];
    try {
      rows = await parseWorkbook(buf);
    } catch {
      return NextResponse.json({ error: "No se pudo leer el Excel. Verificá que sea .xlsx válido." }, { status: 400 });
    }
    if (rows.length === 0) {
      return NextResponse.json({ error: "El Excel está vacío o no tiene filas con datos" }, { status: 400 });
    }

    const existingCats = await queryMany<{ name: string }>(
      `SELECT name FROM vendor_categories WHERE vendor_id = $1`,
      [vendor.id]
    );
    const { items, usedLlm } = await cleanMenu(
      rows,
      existingCats.map((c) => c.name)
    );

    const existingNames = await queryMany<{ name: string }>(
      `SELECT name FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const existingSet = new Set(existingNames.map((p) => p.name.trim().toLowerCase()));
    // Match por SKU cuando la fila lo trae (estable aunque cambie el nombre).
    const existingSkus = await queryMany<{ sku: string }>(
      `SELECT sku FROM products WHERE vendor_id = $1 AND sku IS NOT NULL AND sku <> ''`,
      [vendor.id]
    ).catch(() => []);
    const skuSet = new Set((existingSkus || []).map((p) => String(p.sku).trim()));

    const valid: CleanedItem[] = [];
    const invalid: { row: string; reason: string }[] = [];
    for (const it of items) {
      const name = (it.name || "").trim();
      const price = Number(it.price);
      if (!name) {
        invalid.push({ row: "(sin nombre)", reason: "Falta el nombre" });
        continue;
      }
      if (!Number.isFinite(price)) {
        invalid.push({ row: name, reason: "Precio inválido" });
        continue;
      }
      valid.push({ ...it, name, price });
    }

    const isNewItem = (it: CleanedItem) => {
      const sku = typeof it.sku === "string" ? it.sku.trim() : "";
      if (sku && skuSet.has(sku)) return false;
      return !existingSet.has(it.name.trim().toLowerCase());
    };
    const toImport = valid.filter((it) => isNewItem(it)).length;
    const willUpdate = valid.length - toImport;

    return NextResponse.json({
      action: "analyze",
      usedLlm,
      read: rows.length,
      valid: valid.length,
      toImport,
      willUpdate,
      invalid,
      items: valid.map((it) => ({
        name: it.name,
        price: it.price,
        category: it.category || "",
        description: it.description || "",
        group: it.group || "",
        modifiers: it.modifiers || [],
        sku: typeof it.sku === "string" ? it.sku.trim().slice(0, 64) : "",
      })),
    });
  }

  // ============ FASE IMPORT ============
  if (action === "import") {
    let items: CleanedItem[];
    try {
      items = JSON.parse((form.get("items") as string) || "[]");
    } catch {
      return NextResponse.json({ error: "Datos inválidos para importar" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No hay platos para importar" }, { status: 400 });
    }
    // Extras FUDO (pueden venir del preview FUDO; vacíos = flujo clásico).
    let fudoIngredients: FudoIngredient[] = [];
    let fudoRecipeLines: FudoRecipeLine[] = [];
    let fudoGroups: FudoGroupDef[] = [];
    let fudoGroupOptions: FudoGroupOption[] = [];
    let fudoAssociations: FudoAssociation[] = [];
    let overwriteRecipes = false;
    try {
      const raw = (k: string) => form.get(k) as string | null;
      if (raw("ingredients")) fudoIngredients = JSON.parse(raw("ingredients") || "[]");
      if (raw("recipeLines")) fudoRecipeLines = JSON.parse(raw("recipeLines") || "[]");
      if (raw("fudoGroups")) {
        const g = JSON.parse(raw("fudoGroups") || "{}");
        fudoGroups = g.groups || [];
        fudoGroupOptions = g.groupOptions || [];
        fudoAssociations = g.associations || [];
      }
      overwriteRecipes = raw("overwriteRecipes") === "1";
    } catch {
      // extras opcionales: si fallan, se sigue solo con productos.
    }

    const existingCats = await queryMany<{ name: string }>(
      `SELECT name FROM vendor_categories WHERE vendor_id = $1`,
      [vendor.id]
    );

    const fullVendor = await queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [vendor.id]);
    const plans = await queryMany<Plan>(`SELECT * FROM plans`);
    const plan = resolveVendorPlan(fullVendor as Vendor, plans || []);

    // límite de plan sobre el total resultante
    const existingNames = await queryMany<{ name: string }>(
      `SELECT name FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const existingSet = new Set(existingNames.map((p) => p.name.trim().toLowerCase()));
    const existingSkus = await queryMany<{ sku: string }>(
      `SELECT sku FROM products WHERE vendor_id = $1 AND sku IS NOT NULL AND sku <> ''`,
      [vendor.id]
    ).catch(() => []);
    const skuSet = new Set((existingSkus || []).map((p) => String(p.sku).trim()));
    const newNames = items
      .map((i) => (i.name || "").trim().toLowerCase())
      .filter((n, idx) => {
        if (!n || existingSet.has(n)) return false;
        const sku = typeof (items[idx] as any)?.sku === "string" ? (items[idx] as any).sku.trim() : "";
        // Coincide por SKU con un producto existente → actualiza, no suma.
        if (sku && skuSet.has(sku)) return false;
        return true;
      });
    const totalAfter = existingNames.length + newNames.length;
    if (plan.maxProducts != null && totalAfter > plan.maxProducts) {
      return NextResponse.json(
        {
          error: `Tu plan permite hasta ${plan.maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`,
          code: "plan_limit",
        },
        { status: 403 }
      );
    }

    const catNames = new Set(existingCats.map((c) => c.name.trim().toLowerCase()));
    const createdCategories: string[] = [];
    const errors: { name: string; error: string }[] = [];

    const result = await withTransaction(async (tx) => {
      // crear categorías faltantes
      const neededCats = new Set<string>();
      for (const it of items) {
        const cat = (it.category || "").trim();
        if (cat && !catNames.has(cat.toLowerCase())) neededCats.add(cat);
      }
      for (const cname of neededCats) {
        const pos = await tx.queryOne<{ m: number }>(
          `SELECT count(*)::int AS m FROM vendor_categories WHERE vendor_id = $1`,
          [vendor.id]
        );
        await tx.queryVoid(
          `INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3)`,
          [vendor.id, cname, pos?.m ?? 0]
        );
        createdCategories.push(cname);
      }

      // upsert productos
      let imported = 0;
      let updated = 0;
      const suppliersUpserted = new Set<string>();
      for (const it of items) {
        const name = (it.name || "").trim();
        if (!name) {
          errors.push({ name: "(sin nombre)", error: "Falta el nombre" });
          continue;
        }
        const price = Number(it.price);
        if (!Number.isFinite(price)) {
          errors.push({ name, error: "Precio inválido" });
          continue;
        }
        const sku =
          typeof (it as any).sku === "string" && (it as any).sku.trim() !== ""
            ? (it as any).sku.trim().slice(0, 64)
            : null;
        let existing: { id: string } | null | undefined = null;
        if (sku) {
          existing = await tx.queryOne<{ id: string }>(
            `SELECT id FROM products WHERE vendor_id = $1 AND sku = $2 LIMIT 1`,
            [vendor.id, sku]
          ).catch(() => null);
        }
        if (!existing) {
          existing = await tx.queryOne<{ id: string }>(
            `SELECT id FROM products WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1`,
            [vendor.id, name]
          );
        }

        let productId: string;

        // Extras FUDO por fila (defaults = comportamiento clásico).
        const rowAvailable = (it as CleanedItem).available !== false;
        const rowFeatured = (it as CleanedItem).featured === true;
        const rowCost = Number((it as CleanedItem).cost);
        const rowCostNum = Number.isFinite(rowCost) && rowCost >= 0 ? rowCost : null;
        const rowStock = Number((it as CleanedItem).stock);
        const rowStockNum = Number.isFinite(rowStock) && rowStock >= 0 ? Math.floor(rowStock) : null;
        const rowStockMin = Number((it as CleanedItem).stockMin);
        const rowStockMinNum = Number.isFinite(rowStockMin) && rowStockMin >= 0 ? Math.floor(rowStockMin) : null;
        const rowStockControl = (it as CleanedItem).stockControl === true || rowStockNum != null;

        if (existing) {
          await tx.queryVoid(
            `UPDATE products SET price = $1, category = $2, description = $3, available = $4, featured_today = $5 WHERE id = $6`,
            [price, (it.category || "").trim() || "otras", it.description || null, rowAvailable, rowFeatured, existing.id]
          );
          if (sku) {
            await tx.queryVoid(
              `UPDATE products SET sku = $1 WHERE id = $2`,
              [sku, existing.id]
            ).catch(() => null);
          }
          // Costo/stock FUDO (tolerante a columnas inexistentes).
          if (rowCostNum != null) {
            await tx.queryVoid(`UPDATE products SET cost_last = $1 WHERE id = $2`, [rowCostNum, existing.id]).catch(() => null);
          }
          if (rowStockNum != null || rowStockControl) {
            await tx.queryVoid(
              `UPDATE products SET stock = COALESCE($1, stock), stock_control = $2 WHERE id = $3`,
              [rowStockNum, rowStockControl, existing.id]
            ).catch(() => null);
          }
          if (rowStockMinNum != null) {
            await tx.queryVoid(`UPDATE products SET stock_low_threshold = $1 WHERE id = $2`, [rowStockMinNum, existing.id]).catch(() => null);
          }
          productId = existing.id;
          updated++;
        } else {
          const rows = await tx.query<{ id: string }>(
            `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today)
             VALUES ($1, $2, $3, $4, 'ARS', $5, $6, 'food', $7, $8)
             RETURNING id`,
            [
              vendor.id,
              name,
              it.description || null,
              price,
              (it.category || "").trim() || "otras",
              fullVendor?.neighborhood || null,
              rowAvailable,
              rowFeatured,
            ]
          );
          productId = rows[0]?.id ?? "";
          if (sku && productId) {
            await tx.queryVoid(`UPDATE products SET sku = $1 WHERE id = $2`, [sku, productId]).catch(() => null);
          }
          if (productId && rowCostNum != null) {
            await tx.queryVoid(`UPDATE products SET cost_last = $1 WHERE id = $2`, [rowCostNum, productId]).catch(() => null);
          }
          if (productId && (rowStockNum != null || rowStockControl)) {
            await tx.queryVoid(
              `UPDATE products SET stock = COALESCE($1, stock), stock_control = $2 WHERE id = $3`,
              [rowStockNum, rowStockControl, productId]
            ).catch(() => null);
          }
          if (productId && rowStockMinNum != null) {
            await tx.queryVoid(`UPDATE products SET stock_low_threshold = $1 WHERE id = $2`, [rowStockMinNum, productId]).catch(() => null);
          }
          imported++;
        }

        // Proveedor FUDO: se da de alta para que figure en Compras/Proveedores.
        const rowSupplier = typeof it.supplier === "string" ? it.supplier.trim() : "";
        if (rowSupplier) {
          const sid = await upsertSupplierTx(tx, vendor.id, rowSupplier);
          if (sid) suppliersUpserted.add(sid);
        }

        // Modificantes del producto (columnas "Modificante N descripción/precio").
        // Un solo grupo (columna "Grupo" o "Opciones" por defecto) con todas las opciones detectadas.
        const groupName = (it.group || "").trim() || "Opciones";
        const opts = (Array.isArray(it.modifiers) ? it.modifiers : [])
          .map((m) => ({ label: String(m.desc ?? "").trim(), price_mod: Number(m.price_mod) || 0 }))
          .filter((o) => o.label !== "");
        if (opts.length > 0) {
          // Grupo por producto importado (un solo grupo "Opciones"/"Grupo").
          // Se busca/crea el grupo del vendor y se lo asigna al plato.
          const vendorIdRow = await tx.queryOne<{ vendor_id: string }>(
            `SELECT vendor_id FROM products WHERE id = $1`,
            [productId]
          );
          const vendorId = vendorIdRow?.vendor_id || "";
          if (vendorId) {
            let group = await tx.queryOne<{ id: string }>(
              `SELECT id FROM modifier_groups
               WHERE vendor_id = $1 AND group_name = $2 AND options = $3::jsonb
               LIMIT 1`,
              [vendorId, groupName, JSON.stringify(opts)]
            );
            if (!group) {
              group = await tx.queryOne<{ id: string }>(
                `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant)
                 VALUES ($1, $2, $3, false, 1, false) RETURNING id`,
                [vendorId, groupName, JSON.stringify(opts)]
              );
            }
            if (group) {
              await tx.queryVoid(
                `INSERT INTO product_modifier_links (group_id, product_id, position)
                 VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
                [group.id, productId]
              );
            }
          }
        }
      }
      // ---- Grupos FUDO multi-grupo (hojas 4/5/6): N grupos por producto ----
      let fudoGroupsLinked = 0;
      if (fudoGroups.length > 0 || fudoAssociations.length > 0 || fudoGroupOptions.length > 0) {
        const defByName = new Map<string, FudoGroupDef>();
        for (const g of fudoGroups) defByName.set(normName(g.name), g);
        const optsByGroup = new Map<string, FudoGroupOption[]>();
        for (const o of fudoGroupOptions) {
          const k = normName(o.group);
          if (!optsByGroup.has(k)) optsByGroup.set(k, []);
          optsByGroup.get(k)!.push(o);
        }
        const allProds = await tx.query<{ id: string; name: string }>(
          `SELECT id, name FROM products WHERE vendor_id = $1`,
          [vendor.id]
        ).catch(() => []);
        const prodByName = new Map(allProds.map((p) => [normName(p.name), p.id] as const));
        for (const a of fudoAssociations) {
          const pid = prodByName.get(normName(a.product));
          const opts = (optsByGroup.get(normName(a.group)) ?? [])
            .map((o) => ({ label: String(o.label).trim(), price_mod: Number(o.price) || 0 }))
            .filter((o) => o.label !== "");
          if (!pid || opts.length === 0) {
            if (!pid) errors.push({ name: a.product, error: `Grupo "${a.group}" sin plato coincidente (se omite el link)` });
            continue;
          }
          const def = defByName.get(normName(a.group));
          const gname = def?.name?.trim() || a.group.trim();
          const required = (def?.min ?? 0) > 0;
          const maxSel = Math.max(1, def?.max ?? opts.length ?? 1);
          let group = await tx.queryOne<{ id: string }>(
            `SELECT id FROM modifier_groups WHERE vendor_id = $1 AND group_name = $2 AND options = $3::jsonb LIMIT 1`,
            [vendor.id, gname, JSON.stringify(opts)]
          ).catch(() => null);
          if (!group) {
            group = await tx.queryOne<{ id: string }>(
              `INSERT INTO modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant)
               VALUES ($1, $2, $3, $4, $5, false) RETURNING id`,
              [vendor.id, gname, JSON.stringify(opts), required, maxSel]
            ).catch(() => null);
          }
          if (group?.id) {
            await tx.queryVoid(
              `INSERT INTO product_modifier_links (group_id, product_id, position) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
              [group.id, pid]
            ).catch(() => null);
            fudoGroupsLinked++;
          }
        }
      }

      // ---- Ingredientes FUDO (hoja 3) ----
      let ingredientsUpserted = 0;
      const ingredientIdByName = new Map<string, string>();
      const existingIngs = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM ingredients WHERE vendor_id = $1`,
        [vendor.id]
      ).catch(() => []);
      for (const r of existingIngs) ingredientIdByName.set(normName(r.name), r.id);
      for (const ing of fudoIngredients) {
        const name = String(ing.name || "").trim();
        if (!name) continue;
        const id = await upsertIngredientTx(tx, vendor.id, {
          name,
          category: String(ing.category || "general").trim() || "general",
          unit: normalizeUnit(String(ing.unit || "u")),
          cost: typeof ing.cost === "number" && Number.isFinite(ing.cost) && ing.cost >= 0 ? ing.cost : null,
          wastePct: Math.min(Math.max(Number((ing as { wastePct?: unknown }).wastePct) || 0, 0), 99.99),
        }).catch(() => null);
        if (id) {
          ingredientIdByName.set(normName(name), id);
          ingredientsUpserted++;
        } else {
          errors.push({ name, error: "No se pudo guardar el ingrediente (¿falta migrate-recipes.sql?)" });
        }
      }

      // ---- Recetas formato Portal (hoja Recetas) ----
      let recipesCreated = 0;
      let recipeLinesCreated = 0;
      let recipesSkipped = 0;
      if (fudoRecipeLines.length > 0) {
        const byDish = new Map<string, { dish: string; lines: FudoRecipeLine[]; yield: number; instructions: string }>();
        for (const l of fudoRecipeLines) {
          const k = normName(l.dish);
          if (!byDish.has(k)) byDish.set(k, { dish: l.dish.trim(), lines: [], yield: l.yield || 1, instructions: l.instructions || "" });
          const g = byDish.get(k)!;
          g.lines.push(l);
          if ((l.yield || 0) > 0) g.yield = l.yield;
          if (l.instructions && !g.instructions) g.instructions = l.instructions;
        }
        const prodRows = await tx.query<{ id: string; name: string }>(
          `SELECT id, name FROM products WHERE vendor_id = $1`,
          [vendor.id]
        ).catch(() => []);
        const prodByName = new Map(prodRows.map((p) => [normName(p.name), p.id] as const));
        for (const [, g] of byDish) {
          const pid = prodByName.get(normName(g.dish));
          if (!pid) {
            errors.push({ name: g.dish, error: "Plato de la receta sin coincidencia en la carta (se omite la receta)" });
            continue;
          }
          const cleanLines = g.lines.filter((l) => {
            if (normName(l.ingredient) === normName(g.dish)) {
              errors.push({ name: `${g.dish} / ${l.ingredient}`, error: "Auto-referencia (se omite la línea)" });
              return false;
            }
            return true;
          });
          if (cleanLines.length === 0) continue;
          const hasRecipe = await tx.queryOne<{ id: string }>(
            `SELECT id FROM recipes WHERE product_id = $1 LIMIT 1`,
            [pid]
          ).catch(() => null);
          if (hasRecipe && !overwriteRecipes) {
            recipesSkipped++;
            continue;
          }
          const items: { ingredient_id: string; qty_net: number; unit: string }[] = [];
          for (const l of cleanLines) {
            const iname = l.ingredient.trim();
            let iid: string | null | undefined = ingredientIdByName.get(normName(iname));
            if (!iid) {
              iid = await upsertIngredientTx(tx, vendor.id, {
                name: iname,
                category: "general",
                unit: normalizeUnit(l.unit),
                cost: null,
                wastePct: 0,
              }).catch(() => null);
              if (iid) ingredientIdByName.set(normName(iname), iid);
            }
            if (!iid) {
              errors.push({ name: `${g.dish} / ${iname}`, error: "Insumo no resoluble (se omite la línea)" });
              continue;
            }
            const baseRow = await tx.queryOne<{ base_unit: string }>(
              `SELECT base_unit FROM ingredients WHERE id = $1 LIMIT 1`,
              [iid]
            ).catch(() => null);
            const unit = normalizeUnit(l.unit);
            if (baseRow && unitFactor(unit, baseRow.base_unit) == null) {
              errors.push({ name: `${g.dish} / ${iname}`, error: `Unidad "${l.unit}" incompatible con base "${baseRow.base_unit}" (se omite la línea)` });
              continue;
            }
            items.push({ ingredient_id: iid, qty_net: l.qty, unit });
          }
          if (items.length === 0) {
            errors.push({ name: g.dish, error: "Receta sin líneas válidas (se omite)" });
            continue;
          }
          try {
            if (hasRecipe) {
              await tx.queryVoid(`DELETE FROM recipe_items WHERE recipe_id = $1`, [hasRecipe.id]);
              await tx.queryVoid(`UPDATE recipes SET portions = $1, instructions = $2 WHERE id = $3`, [g.yield > 0 ? g.yield : 1, g.instructions || null, hasRecipe.id]);
              for (let i = 0; i < items.length; i++) {
                await tx.queryVoid(
                  `INSERT INTO recipe_items (recipe_id, ingredient_id, qty_net, unit, position) VALUES ($1, $2, $3, $4, $5)`,
                  [hasRecipe.id, items[i].ingredient_id, items[i].qty_net, items[i].unit, i]
                );
              }
            } else {
              const rr = await tx.query<{ id: string }>(
                `INSERT INTO recipes (vendor_id, product_id, portions, instructions) VALUES ($1, $2, $3, $4) RETURNING id`,
                [vendor.id, pid, g.yield > 0 ? g.yield : 1, g.instructions || null]
              );
              const rid = rr[0]?.id;
              if (!rid) throw new Error("no recipe id");
              for (let i = 0; i < items.length; i++) {
                await tx.queryVoid(
                  `INSERT INTO recipe_items (recipe_id, ingredient_id, qty_net, unit, position) VALUES ($1, $2, $3, $4, $5)`,
                  [rid, items[i].ingredient_id, items[i].qty_net, items[i].unit, i]
                );
              }
            }
            recipesCreated++;
            recipeLinesCreated += items.length;
          } catch {
            errors.push({ name: g.dish, error: "No se pudo guardar la receta (¿falta migrate-recipes.sql?)" });
          }
        }
      }

      return { imported, updated, suppliers: suppliersUpserted.size, fudoGroupsLinked, ingredientsUpserted, recipesCreated, recipeLinesCreated, recipesSkipped };
    });

    return NextResponse.json({
      action: "import",
      imported: result.imported,
      updated: result.updated,
      createdCategories,
      errors,
      fudo: {
        groupsLinked: result.fudoGroupsLinked,
        ingredients: result.ingredientsUpserted,
        recipes: result.recipesCreated,
        recipeLines: result.recipeLinesCreated,
        recipesSkipped: result.recipesSkipped,
        suppliers: result.suppliers,
      },
    });
  }

  // ============ FASE ANALYZE_WA (CSV de WhatsApp Catalogue Exporter) ============
  // El cliente manda el .csv; se devuelve preview editable SIN los bytes de foto
  // (el import re-recibe el archivo y procesa las imágenes).
  if (action === "analyze_wa") {
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Subí el archivo .csv exportado de WhatsApp" }, { status: 400 });
    }
    if (file.size > MAX_WA_SIZE) {
      return NextResponse.json({ error: "El CSV supera los 30 MB (muchas fotos en alta; probá el script scripts/import-wa-csv.mjs)" }, { status: 400 });
    }
    if (!WA_MIME.includes(file.type) && !file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "Solo se admite el .csv de WhatsApp Catalogue Exporter" }, { status: 400 });
    }
    const defaultCategory = String(form.get("category") || "otras").trim() || "otras";
    let waRows: WaRow[];
    try {
      waRows = waRowsOf(await file.text());
    } catch {
      return NextResponse.json({ error: "No se pudo leer el CSV. Verificá que sea el exportado por la extensión." }, { status: 400 });
    }
    if (waRows.length === 0) {
      return NextResponse.json({ error: "El CSV está vacío o no tiene filas con datos" }, { status: 400 });
    }

    const existingNames = await queryMany<{ name: string }>(
      `SELECT name FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const existingSet = new Set(existingNames.map((p) => p.name.trim().toLowerCase()));

    const valid: { index: string; name: string; price: number; category: string; description: string; hasImage: boolean }[] = [];
    const invalid: { row: string; reason: string }[] = [];
    for (const r of waRows) {
      if (!r.name) {
        if (r.imageData) invalid.push({ row: r.index ? `#${r.index}` : "(sin nombre)", reason: "Sin nombre (foto suelta del catálogo)" });
        else invalid.push({ row: r.index ? `#${r.index}` : "(vacía)", reason: "Fila vacía" });
        continue;
      }
      if (r.price == null) {
        invalid.push({ row: r.name, reason: "Sin precio válido" });
        continue;
      }
      valid.push({
        index: r.index,
        name: r.name,
        price: r.price,
        category: defaultCategory,
        description: r.description,
        hasImage: Boolean(waImageBuffer(r.imageData)),
      });
    }

    const toImport = valid.filter((it) => !existingSet.has(it.name.trim().toLowerCase())).length;
    return NextResponse.json({
      action: "analyze_wa",
      usedLlm: false,
      read: waRows.length,
      valid: valid.length,
      toImport,
      willUpdate: valid.length - toImport,
      invalid,
      items: valid,
      extensionUrl: WA_EXTENSION_URL,
    });
  }

  // ============ FASE IMPORT_WA ============
  // Recibe el .csv de nuevo + `items` editados en el preview. Hace match por
  // `index` (estable en el export) con fallback a nombre, procesa la foto y
  // crea/actualiza el producto con su image_url.
  if (action === "import_wa") {
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Falta el .csv original para procesar las fotos" }, { status: 400 });
    }
    if (file.size > MAX_WA_SIZE) {
      return NextResponse.json({ error: "El CSV supera los 30 MB" }, { status: 400 });
    }
    let items: { index?: string; name: string; price: number | string; category?: string; description?: string }[];
    try {
      items = JSON.parse((form.get("items") as string) || "[]");
    } catch {
      return NextResponse.json({ error: "Datos inválidos para importar" }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "No hay productos para importar" }, { status: 400 });
    }
    const waRows = waRowsOf(await file.text());
    const byIndex = new Map(waRows.map((r) => [r.index, r]));
    const byName = new Map(waRows.filter((r) => r.name).map((r) => [r.name.toLowerCase(), r]));

    const fullVendor = await queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [vendor.id]);
    const plans = await queryMany<Plan>(`SELECT * FROM plans`);
    const plan = resolveVendorPlan(fullVendor as Vendor, plans || []);

    const existingNames = await queryMany<{ name: string }>(
      `SELECT name FROM products WHERE vendor_id = $1`,
      [vendor.id]
    );
    const existingSet = new Set(existingNames.map((p) => p.name.trim().toLowerCase()));
    const newNames = items
      .map((i) => (i.name || "").trim().toLowerCase())
      .filter((n) => n && !existingSet.has(n));
    if (plan.maxProducts != null && existingNames.length + newNames.length > plan.maxProducts) {
      return NextResponse.json(
        {
          error: `Tu plan permite hasta ${plan.maxProducts} productos. Actualizá a Gestión integral para productos ilimitados.`,
          code: "plan_limit",
        },
        { status: 403 }
      );
    }

    const createdCategories: string[] = [];
    const errors: { name: string; error: string }[] = [];
    const result = await withTransaction(async (tx) => {
      let imported = 0;
      let updated = 0;
      for (const it of items) {
        const name = (it.name || "").trim();
        if (!name) {
          errors.push({ name: "(sin nombre)", error: "Falta el nombre" });
          continue;
        }
        const price = Number(it.price);
        if (!Number.isFinite(price) || price <= 0) {
          errors.push({ name, error: "Precio inválido" });
          continue;
        }
        const category = (it.category || "").trim() || "otras";
        const description = (it.description || "").trim() || null;

        const src: WaRow | undefined =
          (it.index ? byIndex.get(String(it.index)) : undefined) || byName.get(name.toLowerCase());
        let imageUrl: string | null = null;
        const rawBuf = src ? waImageBuffer(src.imageData) : null;
        if (rawBuf) {
          const hash = crypto.createHash("sha256").update(rawBuf).digest("hex").slice(0, 12);
          const { buf, ext } = await waProcessImage(rawBuf);
          const filename = `wa-${hash}.${ext}`;
          const uploadRoot = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
          const dir = path.join(uploadRoot, "offers", vendor.id);
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, filename), buf);
          imageUrl = `${getSiteUrl()}/uploads/offers/${vendor.id}/${filename}`;
        }

        const existingProd = await tx.queryOne<{ id: string; image_url: string | null }>(
          `SELECT id, image_url FROM products WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1`,
          [vendor.id, name]
        );
        if (existingProd) {
          if (imageUrl) {
            await tx.queryVoid(
              `UPDATE products SET price = $1, category = $2, description = $3, available = true, image_url = $4 WHERE id = $5`,
              [price, category, description, imageUrl, existingProd.id]
            );
          } else {
            await tx.queryVoid(
              `UPDATE products SET price = $1, category = $2, description = $3, available = true WHERE id = $4`,
              [price, category, description, existingProd.id]
            );
          }
          updated++;
        } else {
          const prodType = (fullVendor as Vendor | null)?.vertical === "gastronomia" ? "food" : "product";
          const rows = await tx.query<{ id: string }>(
            `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, image_url)
             VALUES ($1, $2, $3, $4, 'ARS', $5, $6, $7, true, $8)
             RETURNING id`,
            [vendor.id, name, description, price, category, (fullVendor as Vendor | null)?.neighborhood || null, prodType, imageUrl]
          );
          if (rows[0]?.id) imported++;
          const catExists = await tx.queryOne<{ n: number }>(
            `SELECT count(*)::int AS n FROM vendor_categories WHERE vendor_id = $1 AND lower(name) = lower($2)`,
            [vendor.id, category]
          );
          if (!catExists || catExists.n === 0) {
            const pos = await tx.queryOne<{ m: number }>(
              `SELECT count(*)::int AS m FROM vendor_categories WHERE vendor_id = $1`,
              [vendor.id]
            );
            await tx.queryVoid(
              `INSERT INTO vendor_categories (vendor_id, name, position) VALUES ($1, $2, $3)`,
              [vendor.id, category, pos?.m ?? 0]
            );
            createdCategories.push(category);
          }
        }
      }
      return { imported, updated };
    });

    return NextResponse.json({
      action: "import_wa",
      imported: result.imported,
      updated: result.updated,
      createdCategories,
      errors,
    });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}