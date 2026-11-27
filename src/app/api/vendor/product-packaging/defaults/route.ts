import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import {
  PACKAGING_MIGRATION,
  loadPackagingDefaults,
  packagingReady,
} from "@/lib/product-packaging-server";
import { categoryKey, normalizePackagingLines } from "@/lib/product-packaging";

export const dynamic = "force-dynamic";
const GATE_MSG = "El empaque por producto forma parte del plan Gestión integral";

/**
 * Empaque por defecto de una categoría (se carga UNA vez, lo heredan todos
 * los productos de esa categoría con packaging_mode='category').
 * Body: { category: string, lines: [{ ingredient_id, qty }] }
 * lines vacío = quitar el default de la categoría.
 * Los triggers recalculan solos el costo de todos los productos alcanzados.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  if (!(await packagingReady())) {
    return NextResponse.json(
      { ok: false, needs_migration: PACKAGING_MIGRATION, error: `Falta la migración ${PACKAGING_MIGRATION}` },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const key = categoryKey(body?.category);
  if (!key || key.length > 200) {
    return NextResponse.json({ ok: false, error: "Elegí una categoría válida" }, { status: 400 });
  }
  const parsed = normalizePackagingLines(body?.lines);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  try {
    await withTransaction(async (tx) => {
      const ingredientIds = [...new Set(parsed.lines.map((l) => l.ingredient_id))];
      if (ingredientIds.length) {
        const found = await tx.query<{ id: string }>(
          `SELECT id FROM ingredients WHERE vendor_id = $1 AND id = ANY($2::uuid[])`,
          [gate.vendor.id, ingredientIds]
        );
        if (found.length !== ingredientIds.length) throw new Error("Insumo de empaque no encontrado");
      }

      let def = await tx.queryOne<{ id: string }>(
        `SELECT id FROM packaging_defaults WHERE vendor_id = $1 AND category_key = $2 LIMIT 1`,
        [gate.vendor.id, key]
      );
      if (parsed.lines.length === 0) {
        if (def) {
          // El trigger BEFORE DELETE pone en 0 el costo de los productos que
          // heredaban este default.
          await tx.queryVoid(`DELETE FROM packaging_defaults WHERE id = $1`, [def.id]);
        }
        return;
      }
      if (!def) {
        def = await tx.queryOne<{ id: string }>(
          `INSERT INTO packaging_defaults (vendor_id, category_key)
           VALUES ($1, $2) RETURNING id`,
          [gate.vendor.id, key]
        );
      }
      const defaultId = def!.id;
      await tx.queryVoid(`DELETE FROM packaging_default_lines WHERE default_id = $1`, [defaultId]);
      for (const l of parsed.lines) {
        await tx.queryVoid(
          `INSERT INTO packaging_default_lines (default_id, ingredient_id, qty)
           VALUES ($1, $2, $3)`,
          [defaultId, l.ingredient_id, l.qty]
        );
      }
    });
    return NextResponse.json({ ok: true, defaults: await loadPackagingDefaults(gate.vendor.id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo guardar el empaque de la categoría";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
