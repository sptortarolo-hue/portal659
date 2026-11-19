import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";
import { computeBatch, type RecipeLineForBatch } from "@/lib/packing-math";

export const dynamic = "force-dynamic";

const GATE_MSG = "El envasado forma parte del plan Gestión integral";

/** True si la migración migrate-elaboration.sql está aplicada. */
async function elaborationReady(): Promise<{ ready: boolean; missing: string[] }> {
  const missing: string[] = [];
  const batches = await queryOne<{ e: boolean }>(`SELECT to_regclass('public.packing_batches') IS NOT NULL AS e`).catch(() => ({ e: false }));
  if (!batches?.e) missing.push("tabla packing_batches");
  const col = await queryOne<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'count_pack') AS e`
  ).catch(() => ({ e: false }));
  if (!col?.e) missing.push("columna products.count_pack");
  const ing = await queryOne<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ingredients' AND column_name = 'stock') AS e`
  ).catch(() => ({ e: false }));
  if (!ing?.e) missing.push("columna ingredients.stock");
  return { ready: missing.length === 0, missing };
}

/** Últimos lotes del comercio + totales de hoy (TZ Argentina). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const { ready, missing } = await elaborationReady();
  if (!ready) {
    return NextResponse.json(
      { error: `Falta aplicar migrate-elaboration.sql (${missing.join(", ")}).`, needs_migration: true },
      { status: 503 }
    );
  }

  const batches = await queryMany<Record<string, unknown>>(
    `SELECT b.id, b.units, b.total_kg, b.cost_total, b.cost_per_unit, b.created_at,
            p.name AS product_name
     FROM packing_batches b JOIN products p ON p.id = b.product_id
     WHERE b.vendor_id = $1
     ORDER BY b.created_at DESC
     LIMIT 30`,
    [gate.vendor.id]
  );
  const today = await queryOne<{ units: string; total_kg: string; cost_total: string }>(
    `SELECT COALESCE(SUM(units), 0)::text AS units,
            COALESCE(SUM(total_kg), 0)::text AS total_kg,
            COALESCE(SUM(cost_total), 0)::text AS cost_total
     FROM packing_batches
     WHERE vendor_id = $1
       AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
         = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`,
    [gate.vendor.id]
  );
  return NextResponse.json({
    batches: batches || [],
    today: {
      units: Number(today?.units || 0),
      total_kg: Number(today?.total_kg || 0),
      cost_total: Number(today?.cost_total || 0),
    },
  });
}

/**
 * Registra un lote de envasado.
 * Body: { product_id, bags: number[] (kg por bolsa), packedAt?, shelfLifeDays? }
 * - Descuenta insumos (granel proporcional al pesaje + packaging por bolsa).
 * - Suma stock de PAQUETES al terminado y recalcula cost_avg (PMP).
 * - Kardex 'envasado' (salidas de insumos / entrada del terminado).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const { ready, missing } = await elaborationReady();
  if (!ready) {
    return NextResponse.json(
      { error: `Falta aplicar migrate-elaboration.sql (${missing.join(", ")}).`, needs_migration: true },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => null);
  const productId = String(body?.product_id || "");
  const bagsRaw: unknown[] = Array.isArray(body?.bags) ? body.bags : [];
  if (!productId) {
    return NextResponse.json({ error: "Elegí el producto a envasar" }, { status: 400 });
  }
  if (bagsRaw.length === 0) {
    return NextResponse.json({ error: "Pesá al menos una bolsa" }, { status: 400 });
  }
  if (bagsRaw.length > 100) {
    return NextResponse.json({ error: "Un lote no puede superar las 100 bolsas" }, { status: 400 });
  }
  let bags: number[];
  try {
    bags = bagsRaw.map((b, i) => {
      const n = Number(b);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Bolsa ${i + 1}: peso inválido`);
      if (n > 99) throw new Error(`Bolsa ${i + 1}: peso demasiado grande (máx. 99 kg)`);
      return n;
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Pesaje inválido" }, { status: 400 });
  }

  const product = await queryOne<Record<string, any>>(
    `SELECT id, name, unit, count_pack, COALESCE(stock, 0) AS stock, cost_avg, cost_last
     FROM products WHERE id = $1 AND vendor_id = $2`,
    [productId, gate.vendor.id]
  );
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  if (String(product.unit) !== "kg" || product.count_pack !== true) {
    return NextResponse.json(
      { error: "Ese producto no está marcado como envasado (unidad kg + 'cuento paquetes'). Editalo en el catálogo." },
      { status: 400 }
    );
  }

  // Receta del terminado.
  const recipe = await queryOne<{ id: string }>(
    `SELECT id FROM recipes WHERE product_id = $1 AND vendor_id = $2`,
    [productId, gate.vendor.id]
  );
  if (!recipe) {
    return NextResponse.json(
      { error: "El producto no tiene receta. Cargala en Preparación y Costo → Platos.", needs_recipe: true },
      { status: 400 }
    );
  }
  const rawLines = await queryMany<Record<string, any>>(
    `SELECT i.ingredient_id, i.qty_net, i.unit,
            g.name, g.base_unit, g.waste_pct, g.cost_per_unit, g.stock, g.is_elaborated
     FROM recipe_items i JOIN ingredients g ON g.id = i.ingredient_id
     WHERE i.recipe_id = $1
     ORDER BY i.position ASC, i.created_at ASC`,
    [recipe.id]
  );
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "La receta está vacía: agregá insumos (granel + packaging)." }, { status: 400 });
  }
  const elaborated = rawLines.filter((l) => l.is_elaborated === true);
  if (elaborated.length > 0) {
    return NextResponse.json(
      { error: `Envasado con sub-preparaciones no soportado en v1. Saco: ${elaborated.map((l) => l.name).join(", ")}.` },
      { status: 400 }
    );
  }

  const lines: RecipeLineForBatch[] = rawLines.map((l) => ({
    ingredient_id: String(l.ingredient_id),
    name: String(l.name),
    base_unit: (l.base_unit === "ml" ? "ml" : l.base_unit === "u" ? "u" : "g") as "g" | "ml" | "u",
    qty_net: Number(l.qty_net) || 0,
    unit: String(l.unit || "g"),
    waste_pct: Number(l.waste_pct) || 0,
    cost_per_unit: Number(l.cost_per_unit) || 0,
    stock: l.stock === undefined ? undefined : l.stock === null ? null : Number(l.stock),
  }));

  const batch = computeBatch(bags, lines);
  if (batch.missing.length > 0) {
    return NextResponse.json(
      { error: "Stock insuficiente para envasar el lote", missing: batch.missing },
      { status: 409 }
    );
  }

  const createdBy = gate.user.id.startsWith("preview:") ? null : gate.user.id;
  try {
    const result = await withTransaction(async (tx) => {
      // Re-chequeo de stock dentro de la transacción (carrera de dos lotes).
      for (const l of lines) {
        if (l.stock === undefined || l.stock === null) continue;
        const row = await tx.queryOne<{ stock: number }>(
          `SELECT stock FROM ingredients WHERE id = $1 FOR UPDATE`,
          [l.ingredient_id]
        );
        const need = batch.lines.find((r) => r.ingredient_id === l.ingredient_id)?.qty_consumed_base ?? 0;
        const have = row?.stock != null ? Number(row.stock) : 0;
        if (have + 1e-9 < need) {
          throw new Error(`Stock insuficiente de ${l.name} (faltan ${(need - have).toFixed(3)} ${l.base_unit})`);
        }
      }
      const { logStockMovement } = await import("@/lib/stock-ledger");
      for (const r of batch.lines) {
        if (r.qty_consumed_base <= 0) continue;
        await tx.queryVoid(
          `UPDATE ingredients SET stock = stock - $2, updated_at = now() WHERE id = $1 AND stock IS NOT NULL`,
          [r.ingredient_id, r.qty_consumed_base]
        );
        await logStockMovement(tx, {
          vendorId: gate.vendor.id,
          ingredient_id: r.ingredient_id,
          qty_delta: -r.qty_consumed_base,
          reason: "envasado",
          created_by: createdBy,
        });
      }
      const b = await tx.queryOne<{ id: string }>(
        `INSERT INTO packing_batches (vendor_id, product_id, units, total_kg, cost_total, cost_per_unit, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [gate.vendor.id, productId, batch.units, batch.totalKg, batch.costTotal, batch.costPerUnit, createdBy]
      );
      // Terminado: +stock (paquetes) y costo promedio ponderado.
      const prevStock = Number(product.stock) || 0;
      const prevAvg = product.cost_avg != null ? Number(product.cost_avg) : null;
      const newStock = prevStock + batch.units;
      const newAvg =
        prevAvg != null && prevStock > 0
          ? Math.round(((prevAvg * prevStock + batch.costTotal) / newStock) * 100) / 100
          : Math.round(batch.costPerUnit * 10000) / 10000;
      await tx.queryVoid(
        `UPDATE products
         SET stock = COALESCE(stock, 0) + $2, stock_control = true,
             cost_last = $3::numeric,
             cost_avg = $4::numeric
         WHERE id = $1`,
        [productId, batch.units, batch.costPerUnit, newAvg]
      );
      await logStockMovement(tx, {
        vendorId: gate.vendor.id,
        product_id: productId,
        qty_delta: batch.units,
        reason: "envasado",
        created_by: createdBy,
      });
      return b!.id;
    });
    return NextResponse.json({
      batch: {
        id: result,
        units: batch.units,
        total_kg: batch.totalKg,
        cost_total: batch.costTotal,
        cost_per_unit: batch.costPerUnit,
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/Stock insuficiente/.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    throw e;
  }
}
