import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, withTransaction } from "@/lib/db";
import {
  PACKAGING_MIGRATION,
  loadPackagingDefaults,
  loadPackagingLines,
  packagingReady,
} from "@/lib/product-packaging-server";
import { normalizePackagingLines, readPackagingMode, type PackagingLineInput } from "@/lib/product-packaging";

export const dynamic = "force-dynamic";
const GATE_MSG = "El empaque por producto forma parte del plan Gestión integral";
const MIG_MSG = `Falta la migración ${PACKAGING_MIGRATION}`;

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  packaging_mode: string | null;
  packaging_cost: number | null;
};

type IngredientRow = {
  id: string;
  name: string;
  base_unit: string | null;
  cost_per_unit: number | null;
  stock: number | null;
};

function migrationError() {
  return NextResponse.json({ ok: false, needs_migration: PACKAGING_MIGRATION, error: MIG_MSG }, { status: 503 });
}

/** Biblioteca de insumos + líneas de empaque de los productos del comercio. */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await packagingReady())) return migrationError();

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  const products = await queryMany<ProductRow>(
    `SELECT id, name, category, packaging_mode, packaging_cost FROM products WHERE vendor_id = $1 ORDER BY name ASC`,
    [gate.vendor.id]
  ).catch(() => []);

  const targets = productId ? products.filter((p) => p.id === productId) : products;
  if (productId && targets.length === 0) {
    return NextResponse.json({ ok: false, error: "Producto no encontrado" }, { status: 404 });
  }

  const lines = await loadPackagingLines(gate.vendor.id, targets.map((p) => p.id));
  const defaults = await loadPackagingDefaults(gate.vendor.id);
  let ingredients: IngredientRow[] = [];
  try {
    ingredients = await queryMany<IngredientRow>(
      `SELECT id, name, base_unit, cost_per_unit, stock
         FROM ingredients WHERE vendor_id = $1
        ORDER BY name ASC`,
      [gate.vendor.id]
    );
  } catch {
    // DB sin la tabla de insumos (migración de recetas pendiente).
    ingredients = [];
  }

  return NextResponse.json({
    ok: true,
    ready: true,
    mode: targets[0] ? readPackagingMode(targets[0].packaging_mode) : "none",
    products: targets.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category ?? null,
      mode: readPackagingMode(p.packaging_mode),
      packaging_cost: Number(p.packaging_cost) || 0,
      lines: lines.get(p.id) || [],
    })),
    defaults,
    ingredients: ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      base_unit: i.base_unit,
      unit_cost: Number(i.cost_per_unit) || 0,
      stock: i.stock == null ? null : Number(i.stock),
      is_packaging: i.base_unit === "u",
    })),
  });
}

/**
 * Guarda el empaque de uno o varios productos.
 * Body: { productId | productIds, mode?: 'none'|'category'|'simple'|'in_recipe',
 *         lines?: [{ ingredient_id, qty }], enabled?: boolean }
 * - mode 'none' / 'in_recipe' limpia las líneas (en 'in_recipe' el empaque ya
 *   está dentro del lote de envasado, no se suma dos veces).
 * - mode 'category' hereda el default de la categoría (sin líneas propias).
 * - mode 'simple' (o `lines` sin mode) reemplaza las líneas del producto.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await packagingReady())) return migrationError();

  const body = await request.json().catch(() => ({}));
  const idsRaw = Array.isArray(body?.productIds)
    ? body.productIds
    : body?.productId
      ? [body.productId]
      : [];
  const productIds = [...new Set(idsRaw.map((v: unknown) => String(v).trim()).filter(Boolean))];
  if (!productIds.length || productIds.length > 500) {
    return NextResponse.json({ ok: false, error: "Sin productos válidos" }, { status: 400 });
  }

  const parsed = normalizePackagingLines(body?.lines);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  let lines: PackagingLineInput[] = parsed.lines;

  const requestedMode = body?.mode != null
    ? readPackagingMode(body.mode)
    : body?.enabled === false
      ? "none"
      : lines.length > 0
        ? "simple"
        : "none";
  if (body?.mode != null && !["none", "category", "simple", "in_recipe"].includes(String(body.mode))) {
    return NextResponse.json({ ok: false, error: "Modo de empaque inválido" }, { status: 400 });
  }
  if (requestedMode !== "simple") lines = [];

  try {
    const result = await withTransaction(async (tx) => {
      const owned = await tx.query<{ id: string }>(
        `SELECT id FROM products WHERE vendor_id = $1 AND id = ANY($2::uuid[])`,
        [gate.vendor.id, productIds]
      );
      if (owned.length !== productIds.length) throw new Error("Producto no encontrado");

      const ingredientIds = [...new Set(lines.map((l) => l.ingredient_id))];
      if (ingredientIds.length) {
        const found = await tx.query<{ id: string }>(
          `SELECT id FROM ingredients WHERE vendor_id = $1 AND id = ANY($2::uuid[])`,
          [gate.vendor.id, ingredientIds]
        );
        if (found.length !== ingredientIds.length) throw new Error("Insumo de empaque no encontrado");
      }

      let written = 0;
      for (const pid of productIds) {
        await tx.queryVoid(
          `UPDATE products SET packaging_mode = $2 WHERE id = $1 AND vendor_id = $3`,
          [pid, requestedMode, gate.vendor.id]
        );
        await tx.queryVoid(
          `DELETE FROM product_packaging WHERE product_id = $1 AND vendor_id = $2`,
          [pid, gate.vendor.id]
        );
        for (const l of lines) {
          await tx.queryVoid(
            `INSERT INTO product_packaging (vendor_id, product_id, ingredient_id, qty)
             VALUES ($1, $2, $3, $4)`,
            [gate.vendor.id, pid, l.ingredient_id, l.qty]
          );
        }
        written++;
      }
      return { written, mode: requestedMode, lines: lines.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo guardar el empaque";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
