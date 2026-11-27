/**
 * Acceso a datos del empaque por producto. Tolerante a migración sin aplicar:
 * si `migrate-product-packaging.sql` no está en la DB, todo devuelve vacío /
 * 0 y el comportamiento es el histórico.
 */
import { queryMany, queryOne } from "./db.ts";
import { effectiveCostOf, type PackagingCostRow, type PackagingLine } from "./product-packaging.ts";

export const PACKAGING_MIGRATION = "supabase/self-host/migrate-product-packaging.sql";

export async function packagingReady(): Promise<boolean> {
  try {
    const row = await queryOne<{ ok: boolean }>(
      `SELECT to_regclass('public.product_packaging') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'packaging_cost'
         ) AS ok`
    );
    return row?.ok === true;
  } catch {
    return false;
  }
}

/** Expresión SQL segura para sumar el empaque en un SELECT. */
export function packagingCostExpr(ready: boolean): string {
  return ready ? "COALESCE(packaging_cost, 0)" : "0::numeric";
}

export type PackagingDefault = {
  id: string;
  category_key: string;
  category: string | null;
  lines: PackagingLine[];
};

/** Defaults de empaque por categoría, con sus líneas ya resueltas. */
export async function loadPackagingDefaults(vendorId: string): Promise<PackagingDefault[]> {
  if (!(await packagingReady())) return [];
  try {
    const rows = await queryMany<{
      id: string;
      category_key: string;
      category: string | null;
    }>(
      `SELECT d.id, d.category_key, c.name AS category
         FROM packaging_defaults d
         LEFT JOIN categories c
           ON c.vendor_id = d.vendor_id AND lower(trim(c.name)) = d.category_key
        WHERE d.vendor_id = $1
        ORDER BY d.category_key ASC`,
      [vendorId]
    );
    const lineRows = await queryMany<{
      default_id: string;
      ingredient_id: string;
      qty: number;
      name: string;
      cost_per_unit: number;
      base_unit: string | null;
    }>(
      `SELECT dl.default_id, dl.ingredient_id, dl.qty,
              i.name, i.cost_per_unit, i.base_unit
         FROM packaging_default_lines dl
         JOIN packaging_defaults d ON d.id = dl.default_id
         JOIN ingredients i ON i.id = dl.ingredient_id
        WHERE d.vendor_id = $1
        ORDER BY i.name ASC`,
      [vendorId]
    );
    const byDefault = new Map<string, PackagingLine[]>();
    for (const r of lineRows || []) {
      const id = String(r.default_id);
      if (!byDefault.has(id)) byDefault.set(id, []);
      byDefault.get(id)!.push({
        ingredient_id: String(r.ingredient_id),
        name: String(r.name ?? "Empaque"),
        qty: Number(r.qty) || 0,
        unit_cost: Number(r.cost_per_unit) || 0,
        base_unit: r.base_unit ?? null,
      });
    }
    return (rows || []).map((d) => ({
      id: String(d.id),
      category_key: String(d.category_key),
      category: d.category ?? null,
      lines: byDefault.get(String(d.id)) || [],
    }));
  } catch {
    // Sin tabla categories (o defaults): devolver vacío es seguro.
    return [];
  }
}

type LineRow = {
  product_id: string;
  ingredient_id: string;
  qty: number;
  name: string;
  cost_per_unit: number;
  base_unit: string | null;
};

/** Líneas de empaque por producto (insumo + costo unitario vigente). */
export async function loadPackagingLines(
  vendorId: string,
  productIds: string[]
): Promise<Map<string, PackagingLine[]>> {
  const out = new Map<string, PackagingLine[]>();
  if (!productIds.length || !(await packagingReady())) return out;
  try {
    const rows = await queryMany<LineRow>(
      `SELECT pp.product_id, pp.ingredient_id, pp.qty,
              i.name, i.cost_per_unit, i.base_unit
         FROM product_packaging pp
         JOIN ingredients i ON i.id = pp.ingredient_id
        WHERE pp.vendor_id = $1 AND pp.product_id = ANY($2::uuid[])
        ORDER BY i.name ASC`,
      [vendorId, productIds]
    );
    for (const r of rows || []) {
      const pid = String(r.product_id);
      if (!out.has(pid)) out.set(pid, []);
      out.get(pid)!.push({
        ingredient_id: String(r.ingredient_id),
        name: String(r.name ?? "Empaque"),
        qty: Number(r.qty) || 0,
        unit_cost: Number(r.cost_per_unit) || 0,
        base_unit: r.base_unit ?? null,
      });
    }
  } catch {
    // DB sin tabla ingredients (migración de recetas pendiente): sin líneas.
  }
  return out;
}

/**
 * Enriquece filas de producto con `packaging_lines`, `packaging_cost` y
 * `effective_cost` para que el panel y el asistente muestren la misma cuenta.
 * No pisa valores ya presentes cuando la migración no está aplicada.
 */
export async function attachPackagingToRows<T extends Record<string, unknown>>(
  rows: T[],
  vendorId: string
): Promise<(T & { packaging_lines: PackagingLine[]; effective_cost: number | null })[]> {
  const ready = await packagingReady();
  if (!ready || !rows?.length) {
    return (rows || []).map((r) => ({
      ...r,
      packaging_lines: [],
      effective_cost: effectiveCostOf(r as PackagingCostRow),
    }));
  }
  const ids = rows.map((r) => String(r.id)).filter(Boolean);
  const lines = await loadPackagingLines(vendorId, ids);
  return rows.map((r) => ({
    ...r,
    packaging_lines: lines.get(String(r.id)) || [],
    effective_cost: effectiveCostOf(r as PackagingCostRow),
  }));
}
