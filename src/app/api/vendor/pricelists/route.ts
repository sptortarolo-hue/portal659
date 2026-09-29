import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import type { EffectivePlan } from "@/lib/plans";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

function canInventory(plan: Pick<EffectivePlan, "can">) {
  return plan.can("recipes") || plan.can("inventory");
}

/** Lista precios por proveedor (filtro opcional por target). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canInventory(gate.plan)) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const url = new URL(request.url);
  const supplierId = url.searchParams.get("supplier_id");
  const productId = url.searchParams.get("product_id");
  const variantId = url.searchParams.get("variant_id");
  const ingredientId = url.searchParams.get("ingredient_id");
  const conds = ["pl.vendor_id = $1"];
  const vals: unknown[] = [gate.vendor.id];
  if (supplierId) {
    vals.push(supplierId);
    conds.push(`pl.supplier_id = $${vals.length}`);
  }
  if (productId) {
    vals.push(productId);
    conds.push(`pl.product_id = $${vals.length}`);
  }
  if (variantId) {
    vals.push(variantId);
    conds.push(`pl.variant_id = $${vals.length}`);
  }
  if (ingredientId) {
    vals.push(ingredientId);
    conds.push(`pl.ingredient_id = $${vals.length}`);
  }
  const rows = await queryMany<Record<string, unknown>>(
    `SELECT pl.*, s.name AS supplier_name
     FROM supplier_pricelists pl JOIN suppliers s ON s.id = pl.supplier_id
     WHERE ${conds.join(" AND ")}
     ORDER BY pl.updated_at DESC LIMIT 500`,
    vals
  ).catch(() => []);
  return NextResponse.json({ pricelists: rows || [] });
}

/** Alta/actualización de precio (upsert por proveedor + target). */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!canInventory(gate.plan)) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const supplier_id = String(body?.supplier_id || "");
  const price = Number(body?.price);
  const unit = typeof body?.unit === "string" && body.unit.trim() ? String(body.unit).trim().slice(0, 12) : null;
  const ingredient_id = String(body?.ingredient_id || "") || null;
  const product_id = String(body?.product_id || "") || null;
  const variant_id = String(body?.variant_id || "") || null;
  if (!supplier_id) return NextResponse.json({ error: "supplier_id requerido" }, { status: 400 });
  if (!isFinite(price) || price < 0) {
    return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
  }
  if ((ingredient_id ? 1 : 0) + (product_id ? 1 : 0) + (variant_id ? 1 : 0) !== 1) {
    return NextResponse.json({ error: "Indicá un insumo, producto o variante" }, { status: 400 });
  }
  const sup = await queryOne<{ id: string }>(
    `SELECT id FROM suppliers WHERE id = $1 AND vendor_id = $2`,
    [supplier_id, gate.vendor.id]
  );
  if (!sup) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  if (ingredient_id) {
    const ing = await queryOne<{ id: string }>(
      `SELECT id FROM ingredients WHERE id = $1 AND vendor_id = $2`,
      [ingredient_id, gate.vendor.id]
    );
    if (!ing) return NextResponse.json({ error: "Insumo inválido" }, { status: 400 });
  }
  if (product_id) {
    const p = await queryOne<{ id: string }>(
      `SELECT id FROM products WHERE id = $1 AND vendor_id = $2`,
      [product_id, gate.vendor.id]
    );
    if (!p) return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
  }
  if (variant_id) {
    const v = await queryOne<{ id: string }>(
      `SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = $1 AND p.vendor_id = $2`,
      [variant_id, gate.vendor.id]
    );
    if (!v) return NextResponse.json({ error: "Variante inválida" }, { status: 400 });
  }
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM supplier_pricelists WHERE supplier_id = $1
     AND COALESCE(ingredient_id::text, '') = COALESCE($2::text, '')
     AND COALESCE(product_id::text, '') = COALESCE($3::text, '')
     AND COALESCE(variant_id::text, '') = COALESCE($4::text, '') LIMIT 1`,
    [supplier_id, ingredient_id, product_id, variant_id]
  ).catch(() => null);
  try {
    if (existing) {
      await queryOne(
        `UPDATE supplier_pricelists SET price = $1, unit = $2, updated_at = now() WHERE id = $3`,
        [price, unit, existing.id]
      );
      return NextResponse.json({ ok: true, id: existing.id });
    }
    const row = await queryOne<{ id: string }>(
      `INSERT INTO supplier_pricelists (supplier_id, vendor_id, ingredient_id, product_id, variant_id, price, unit)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [supplier_id, gate.vendor.id, ingredient_id, product_id, variant_id, price, unit]
    );
    if (!row) return NextResponse.json({ error: "No se pudo guardar (¿migración pendiente?)" }, { status: 503 });
    return NextResponse.json({ ok: true, id: row.id });
  } catch {
    return NextResponse.json({ error: "Falta aplicar la migración de inventario en la base de datos" }, { status: 503 });
  }
}
