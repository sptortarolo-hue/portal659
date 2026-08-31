import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import { cleanMenu } from "@/lib/llm";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import type { Plan, Vendor } from "@/types/database";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
];

export const runtime = "nodejs"; // xlsx no corre en edge

type CleanedItem = {
  name: string;
  price: number;
  category?: string | null;
  description?: string | null;
};

function parseWorkbook(buf: Buffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const first = wb.SheetNames[0];
  const sheet = wb.Sheets[first];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const form = await request.formData();
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
    rows = parseWorkbook(buf);
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

  if (items.length === 0) {
    return NextResponse.json({ error: "No se pudo detectar ningún plato en el archivo" }, { status: 422 });
  }

  const fullVendor = await queryOne<Vendor>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [vendor.id]);
  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(fullVendor as Vendor, plans || []);

  // cuenta el total resultante tras importar (upsert por nombre no suma si ya existe)
  const existingNames = await queryMany<{ name: string }>(
    `SELECT name FROM products WHERE vendor_id = $1`,
    [vendor.id]
  );
  const existingSet = new Set(existingNames.map((p) => p.name.trim().toLowerCase()));
  const newNames = items
    .map((i) => i.name.trim().toLowerCase())
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
    // 1) crear categorías faltantes
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

    // 2) upsert productos
    let imported = 0;
    let updated = 0;
    const insertedIds = new Map<string, string>();

    for (const it of items as CleanedItem[]) {
      const name = it.name.trim();
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

      if (existing) {
        await tx.queryVoid(
          `UPDATE products SET price = $1, category = $2, description = $3, available = true WHERE id = $4`,
          [price, it.category?.trim() || "otras", it.description || null, existing.id]
        );
        updated++;
      } else {
        const inserted = await tx.queryOne<{ id: string }>(
          `INSERT INTO products (vendor_id, name, description, price, currency, category, neighborhood, type, available, featured_today)
           VALUES ($1, $2, $3, $4, 'ARS', $5, $6, 'food', true, false) RETURNING id`,
          [
            vendor.id,
            name,
            it.description || null,
            price,
            it.category?.trim() || "otras",
            fullVendor?.neighborhood || null,
          ]
        );
        if (inserted) insertedIds.set(name.toLowerCase(), inserted.id);
        imported++;
      }
    }

    return { imported, updated };
  });

  return NextResponse.json({
    imported: result.imported,
    updated: result.updated,
    createdCategories,
    errors,
    usedLlm,
    total: items.length,
  });
}
