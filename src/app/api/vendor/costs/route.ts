import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

type Kind = "product" | "variant" | "ingredient";

/**
 * Edición directa del costo de referencia (desde "Precios por proveedor").
 *
 * Body: { targets: [{ kind: "product"|"variant"|"ingredient", id, cost: number|null }] }
 * - product → products.cost_last · variant → product_variants.cost_last
 *   · ingredient → ingredients.cost_per_unit.
 * - cost null = limpiar (sin dato). Tolerante a migraciones sin aplicar.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const raw = Array.isArray(body?.targets) ? body.targets : [];
  const targets: { kind: Kind; id: string; cost: number | null }[] = [];
  for (const t of raw as Record<string, unknown>[]) {
    if (!t || typeof t !== "object") continue;
    const kind = t.kind === "product" || t.kind === "variant" || t.kind === "ingredient" ? t.kind : null;
    const id = String(t.id ?? "").trim();
    if (!kind || !/^[0-9a-f-]{36}$/i.test(id)) continue;
    let cost: number | null = null;
    if (t.cost !== null && t.cost !== undefined && t.cost !== "") {
      const n = Number(String(t.cost).replace(",", "."));
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ ok: false, error: "El costo debe ser un número mayor o igual a 0" }, { status: 400 });
      }
      cost = Math.round(n * 10000) / 10000; // ingredients.cost_per_unit es numeric(12,4)
    }
    targets.push({ kind, id, cost });
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "Sin objetivos para actualizar" }, { status: 400 });
  }

  try {
    const result = await withTransaction(async (tx) => {
      const cols = await tx.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public'
            AND ((table_name IN ('products', 'product_variants') AND column_name = 'cost_last')
              OR (table_name = 'ingredients' AND column_name = 'cost_per_unit'))`
      );
      const has = (t: string, c: string) => cols.some((r) => r.table_name === t && r.column_name === c);

      let updated = 0;
      let skipped = 0;
      for (const t of targets) {
        if (t.kind === "product") {
          if (!has("products", "cost_last")) { skipped++; continue; }
          const upd = await tx.query<{ id: string }>(
            `UPDATE products SET cost_last = $2::numeric WHERE id = $1 AND vendor_id = $3 RETURNING id`,
            [t.id, t.cost, gate.vendor.id]
          );
          if (upd.length > 0) updated++;
        } else if (t.kind === "variant") {
          if (!has("product_variants", "cost_last")) { skipped++; continue; }
          const upd = await tx.query<{ id: string }>(
            `UPDATE product_variants v SET cost_last = $2::numeric
              FROM products p WHERE p.id = v.product_id AND v.id = $1 AND p.vendor_id = $3
              RETURNING v.id`,
            [t.id, t.cost, gate.vendor.id]
          );
          if (upd.length > 0) updated++;
        } else {
          if (!has("ingredients", "cost_per_unit")) { skipped++; continue; }
          const upd = await tx.query<{ id: string }>(
            `UPDATE ingredients SET cost_per_unit = $2::numeric WHERE id = $1 AND vendor_id = $3 RETURNING id`,
            [t.id, t.cost, gate.vendor.id]
          );
          if (upd.length > 0) updated++;
        }
      }
      return { updated, skipped };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[costs] update error:", e);
    return NextResponse.json({ ok: false, error: "No se pudieron actualizar los costos" }, { status: 500 });
  }
}
