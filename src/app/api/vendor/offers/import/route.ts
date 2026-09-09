import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { cleanMenu } from "@/lib/llm";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { Plan, Vendor } from "@/types/database";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

export const runtime = "nodejs"; // exceljs no corre en edge

type CleanedItem = {
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
  group?: string | null;
  modifiers?: { desc: string; price_mod: number }[];
};

// Headers reconocidos por campo (para detectar la fila de encabezado y mapear)
const HEADER_ALIASES: Record<"name" | "price" | "category" | "description", string[]> = {
  name: ["nombre", "plato", "producto", "item", "articulo", "comida", "menu", "name", "descripcion del plato"],
  price: ["precio", "price", "valor", "p", "$", "precio$"],
  category: ["categoria", "categoría", "seccion", "sección", "rubro", "cat", "tipo", "category"],
  description: ["descripcion", "descripción", "desc", "detalle", "description"],
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
  for (const field of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
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
    rows.push((row.values as unknown[]).slice(1).map((v) => (v == null ? "" : String(v))));
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
        fields[c] = field === "name" ? 1 : field === "price" ? 2 : field === "category" ? 3 : 4;
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
        key = HEADER_ALIASES[(field === 1 ? "name" : field === 2 ? "price" : field === 3 ? "category" : "description") as keyof typeof HEADER_ALIASES][0];
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
      return NextResponse.json({ error: "El archivo supera los 5 MB" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith(".xlsx")) {
      return NextResponse.json({ error: "Solo se admiten archivos .xlsx" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
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

    const toImport = valid.filter((it) => !existingSet.has(it.name.trim().toLowerCase())).length;
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
    const newNames = items
      .map((i) => (i.name || "").trim().toLowerCase())
      .filter((n) => n && !existingSet.has(n));
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

        const existing = await tx.queryOne<{ id: string }>(
          `SELECT id FROM products WHERE vendor_id = $1 AND lower(name) = lower($2) LIMIT 1`,
          [vendor.id, name]
        );

        let productId: string;

        if (existing) {
          await tx.queryVoid(
            `UPDATE products SET price = $1, category = $2, description = $3, available = true WHERE id = $4`,
            [price, (it.category || "").trim() || "otras", it.description || null, existing.id]
          );
          productId = existing.id;
          updated++;
        } else {
          const rows = await tx.query<{ id: string }>(
            `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today)
             VALUES ($1, $2, $3, $4, 'ARS', $5, $6, 'food', true, false)
             RETURNING id`,
            [
              vendor.id,
              name,
              it.description || null,
              price,
              (it.category || "").trim() || "otras",
              fullVendor?.neighborhood || null,
            ]
          );
          productId = rows[0]?.id ?? "";
          imported++;
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
      return { imported, updated };
    });

    return NextResponse.json({
      action: "import",
      imported: result.imported,
      updated: result.updated,
      createdCategories,
      errors,
    });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}