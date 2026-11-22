import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";
const MIGRATION_MSG = "Falta aplicar la migración supabase/self-host/migrate-inventory.sql en la base";

type TargetKind = "product" | "variant" | "ingredient";
type Target = { kind: TargetKind; id: string; inherit_variants?: boolean };

/**
 * Aplica el MEJOR precio por proveedor como costo (cost_last / cost_per_unit).
 *
 * Body:
 *   { all?: boolean }                          → todos los targets con precio cargado
 *   { targets?: [{kind:"product|variant|ingredient", id, inherit_variants?}] }
 *
 * - Regla "mejor precio": MIN(price) entre los proveedores de ese target
 *   (mismo criterio que la reposición usa para sugerir proveedor).
 * - inherit_variants (solo product): además pisa las variantes del producto
 *   QUE NO tengan precio propio (decisión: las variantes NO heredan solas).
 * - No recacula listas de margen ni toca precios de venta: devuelve
 *   `affectedLists` para que la UI avise y el comercio decida.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const all = body?.all === true;
  const rawTargets: unknown = body?.targets;
  const targetsIn: Target[] = [];
  if (Array.isArray(rawTargets)) {
    for (const t of rawTargets as Record<string, unknown>[]) {
      if (!t || typeof t !== "object") continue;
      const kind =
        t.kind === "product" || t.kind === "variant" || t.kind === "ingredient"
          ? (t.kind as TargetKind)
          : null;
      const id = String(t.id ?? "").trim();
      if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      targetsIn.push({ kind, id, inherit_variants: t.inherit_variants === true });
    }
  }
  if (!all && targetsIn.length === 0) {
    return NextResponse.json({ ok: false, error: "Sin objetivos para aplicar" }, { status: 400 });
  }

  // Tolerante a migraciones sin aplicar.
  try {
    const tab = await queryOne<{ exists: boolean }>(
      `SELECT to_regclass('public.supplier_pricelists') IS NOT NULL AS exists`
    );
    if (!tab?.exists) {
      return NextResponse.json({ ok: false, error: MIGRATION_MSG }, { status: 503 });
    }
    const cols = await queryMany<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name IN ('products', 'product_variants') AND column_name = 'cost_last')
            OR (table_name = 'ingredients' AND column_name = 'cost_per_unit'))`
    );
    const colSet = new Set(cols.map((c) => `${c.table_name}.${c.column_name}`));
    const hasCostProducts = colSet.has("products.cost_last");
    const hasCostVariants = colSet.has("product_variants.cost_last");
    const hasCostIngredients = colSet.has("ingredients.cost_per_unit");

    const result = await withTransaction(async (tx) => {
      const rows = await tx.query<{
        supplier_id: string; product_id: string | null; variant_id: string | null; ingredient_id: string | null; price: number;
      }>(
        `SELECT supplier_id, product_id, variant_id, ingredient_id, price::float8 AS price
           FROM supplier_pricelists WHERE vendor_id = $1`,
        [gate.vendor.id]
      );

      // Mejor precio por target.
      const best = new Map<string, number>();
      for (const r of rows) {
        const key = r.product_id != null ? `p:${r.product_id}` : r.variant_id != null ? `v:${r.variant_id}` : r.ingredient_id != null ? `i:${r.ingredient_id}` : null;
        if (!key) continue;
        const cur = best.get(key);
        if (cur == null || Number(r.price) < cur) best.set(key, Number(r.price));
      }

      let targets: Target[];
      if (all) {
        targets = [...best.keys()].map((k) => ({
          kind: (k.startsWith("p:") ? "product" : k.startsWith("v:") ? "variant" : "ingredient") as TargetKind,
          id: k.slice(2),
          inherit_variants: body?.inherit_variants === true && k.startsWith("p:"),
        }));
      } else {
        targets = targetsIn.filter((t) => best.has(`${t.kind === "product" ? "p" : t.kind === "variant" ? "v" : "i"}:${t.id}`));
      }

      let applied = 0;
      let skippedNoPrice = 0;
      const changedProducts: string[] = [];
      const changedVariantProducts: string[] = [];

      for (const t of targets) {
        const price = best.get(`${t.kind === "product" ? "p" : t.kind === "variant" ? "v" : "i"}:${t.id}`);
        if (price == null) {
          skippedNoPrice++;
          continue;
        }
        if (t.kind === "product") {
          if (!hasCostProducts) { skippedNoPrice++; continue; }
          const upd = await tx.query<{ id: string }>(
            `UPDATE products SET cost_last = $2::numeric WHERE id = $1 AND vendor_id = $3 RETURNING id`,
            [t.id, price, gate.vendor.id]
          );
          if (upd.length > 0) {
            applied++;
            changedProducts.push(t.id);
            if (t.inherit_variants && hasCostVariants) {
              // Variantes sin precio propio heredan el costo del producto.
              await tx.queryVoid(
                `UPDATE product_variants v SET cost_last = $2::numeric
                  WHERE v.product_id = $1
                    AND NOT EXISTS (SELECT 1 FROM supplier_pricelists pl WHERE pl.variant_id = v.id)`,
                [t.id, price]
              );
            }
          }
        } else if (t.kind === "variant") {
          if (!hasCostVariants) { skippedNoPrice++; continue; }
          const upd = await tx.query(
            `UPDATE product_variants v SET cost_last = $2::numeric
              FROM products p WHERE p.id = v.product_id AND v.id = $1 AND p.vendor_id = $3
              RETURNING p.id AS pid`,
            [t.id, price, gate.vendor.id]
          );
          if (upd.length > 0) {
            applied++;
            changedVariantProducts.push(String(upd[0].pid));
          }
        } else {
          if (!hasCostIngredients) { skippedNoPrice++; continue; }
          const upd = await tx.query<{ id: string }>(
            `UPDATE ingredients SET cost_per_unit = $2::numeric WHERE id = $1 AND vendor_id = $3 RETURNING id`,
            [t.id, price, gate.vendor.id]
          );
          if (upd.length > 0) applied++;
        }
      }

      // Listas de margen tocadas (para el aviso de "¿recalcular?").
      const affectedLists: string[] = [];
      try {
        const pids = [...new Set([...changedProducts, ...changedVariantProducts])];
        if (pids.length > 0) {
          const lr = await tx.query<{ id: string }>(
            `SELECT DISTINCT margin_list_id AS id FROM products
              WHERE vendor_id = $1 AND margin_list_id IS NOT NULL AND id = ANY($2)`,
            [gate.vendor.id, pids]
          );
          affectedLists.push(...lr.map((r) => String(r.id)));
        }
      } catch {
        /* sin migrate-margin-lists: sin aviso */
      }

      return { applied, skippedNoPrice, affectedLists };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[pricelists] apply-cost error:", e);
    return NextResponse.json({ ok: false, error: "No se pudo aplicar el costo" }, { status: 500 });
  }
}
