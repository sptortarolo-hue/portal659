import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { unitFactor } from "@/lib/costing";
import { NextResponse } from "next/server";
import type { Ingredient, ReceiptType } from "@/types/database";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan GestiÃ³n integral";

const VALID_RECEIPTS: ReceiptType[] = [
  "factura_a",
  "factura_b",
  "factura_c",
  "remito",
  "ticket",
  "ninguno",
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Lista de compras (mÃ¡s recientes primero, con proveedor y cantidad de lÃ­neas). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes") && !gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const purchases = await queryMany<Record<string, unknown>>(
    `SELECT p.*, s.name AS supplier_name,
            (SELECT COUNT(*)::int FROM purchase_items i WHERE i.purchase_id = p.id) AS items_count
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.vendor_id = $1
     ORDER BY p.purchased_at DESC, p.created_at DESC
     LIMIT 100`,
    [gate.vendor.id]
  );
  return NextResponse.json({ purchases: purchases || [] });
}

/**
 * Registra una compra y actualiza costos + stock.
 * Body: { supplier_id?, purchased_at?, receipt_type?, receipt_number?, notes?,
 *         items: [{ ingredient_id, qty, unit, unit_cost }]
 *              | [{ product_id?, variant_id?, qty, unit_cost }] }
 * Insumos: costo neto por unidad base (pisa ingredients.cost_per_unit).
 * Mercadería: entra stock, pisa cost_last y recalcula cost_avg ponderado;
 * si hay supplier_id actualiza la lista de precios del proveedor.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes") && !gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const body = await request.json();
  const supplier_id: string | null = body?.supplier_id || null;
  const purchased_at: string | null = body?.purchased_at || null;
  const receipt_type: ReceiptType = VALID_RECEIPTS.includes(body?.receipt_type)
    ? body.receipt_type
    : "ninguno";
  const receipt_number =
    body?.receipt_number != null && String(body.receipt_number).trim() !== ""
      ? String(body.receipt_number).trim()
      : null;
  const notes =
    body?.notes != null && String(body.notes).trim() !== "" ? String(body.notes).trim() : null;
  const rawItems: unknown = body?.items;

  if (supplier_id) {
    const s = await queryOne<{ id: string }>(
      `SELECT id FROM suppliers WHERE id = $1 AND vendor_id = $2`,
      [supplier_id, gate.vendor.id]
    );
    if (!s) return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }
  if (purchased_at && !/^\d{4}-\d{2}-\d{2}$/.test(purchased_at)) {
    return NextResponse.json({ error: "Fecha invÃ¡lida (usÃ¡ AAAA-MM-DD)" }, { status: 400 });
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "La compra necesita al menos una lÃ­nea" }, { status: 400 });
  }

  const ingIds = Array.from(
    new Set((rawItems as any[]).map((i) => String(i?.ingredient_id || "")).filter(Boolean))
  );
  const prodIds = Array.from(
    new Set((rawItems as any[]).map((i) => String(i?.product_id || "")).filter(Boolean))
  );
  const varIds = Array.from(
    new Set((rawItems as any[]).map((i) => String(i?.variant_id || "")).filter(Boolean))
  );
  if (ingIds.length === 0 && prodIds.length === 0 && varIds.length === 0) {
    return NextResponse.json({ error: "La compra necesita al menos una línea válida" }, { status: 400 });
  }
  const ings = ingIds.length
    ? await queryMany<Ingredient>(
        `SELECT * FROM ingredients WHERE id = ANY($1) AND vendor_id = $2`,
        [ingIds, gate.vendor.id]
      )
    : [];
  const ingMap = new Map((ings || []).map((i) => [i.id, i]));
  const prows = prodIds.length
    ? await queryMany<Record<string, any>>(
        `SELECT id, name, stock, COALESCE(stock_control, false) AS stock_control
         FROM products WHERE id = ANY($1) AND vendor_id = $2`,
        [prodIds, gate.vendor.id]
      )
    : [];
  const prodMap = new Map((prows || []).map((p) => [p.id, p]));
  // Costos (tolerante a migración sin aplicar).
  let hasCostCols = false;
  try {
    const chk = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'cost_last') AS exists`
    );
    hasCostCols = chk?.exists === true;
  } catch { /* noop */ }
  let hasVarCost = false;
  try {
    const chk = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'cost_last') AS exists`
    );
    hasVarCost = chk?.exists === true;
  } catch { /* noop */ }
  if (hasCostCols && prodIds.length) {
    const costs = await queryMany<{ id: string; cost_last: number | null; cost_avg: number | null }>(
      `SELECT id, cost_last, cost_avg FROM products WHERE id = ANY($1) AND vendor_id = $2`,
      [prodIds, gate.vendor.id]
    ).catch(() => []);
    for (const c of costs || []) {
      const p = prodMap.get(c.id) as any;
      if (p) { p.cost_last = c.cost_last; p.cost_avg = c.cost_avg; }
    }
  }
  const vrows = varIds.length
    ? await queryMany<Record<string, any>>(
        `SELECT v.id, v.product_id, v.stock
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ANY($1) AND p.vendor_id = $2`,
        [varIds, gate.vendor.id]
      )
    : [];
  const varMap = new Map((vrows || []).map((v) => [v.id, v]));
  if (hasVarCost && varIds.length) {
    const vcosts = await queryMany<{ id: string; cost_last: number | null }>(
      `SELECT v.id, v.cost_last FROM product_variants v JOIN products p ON p.id = v.product_id
       WHERE v.id = ANY($1) AND p.vendor_id = $2`,
      [varIds, gate.vendor.id]
    ).catch(() => []);
    for (const c of vcosts || []) {
      const v = varMap.get(c.id) as any;
      if (v) v.cost_last = c.cost_last;
    }
  }

  // Normalizar + validar lÃ­neas (conversiÃ³n a unidad base).
  type NormLine =
    | { kind: "ingredient"; ingredient_id: string; qty: number; unit: string; unit_cost: number; qty_base: number; unit_cost_net: number; line_total: number }
    | { kind: "product"; product_id: string; qty: number; unit_cost: number; line_total: number }
    | { kind: "variant"; variant_id: string; product_id: string; qty: number; unit_cost: number; line_total: number };
  const items: NormLine[] = [];
  for (let idx = 0; idx < (rawItems as any[]).length; idx++) {
    const raw = (rawItems as any[])[idx];
    // Mercadería: producto o variante (cantidad entera + costo unitario).
    const pid = String(raw?.product_id || "");
    const vid = String(raw?.variant_id || "");
    if (pid || vid) {
      const mQty = Math.floor(Number(raw?.qty));
      if (!Number.isFinite(mQty) || mQty <= 0) {
        return NextResponse.json({ error: `Línea ${idx + 1}: cantidad inválida` }, { status: 400 });
      }
      const mCost = round2(Number(raw?.unit_cost));
      if (!isFinite(mCost) || mCost < 0) {
        return NextResponse.json({ error: `Línea ${idx + 1}: costo inválido` }, { status: 400 });
      }
      if (vid) {
        const v = varMap.get(vid) as any;
        if (!v) return NextResponse.json({ error: `Línea ${idx + 1}: variante inválida` }, { status: 400 });
        items.push({ kind: "variant", variant_id: vid, product_id: String(v.product_id), qty: mQty, unit_cost: mCost, line_total: round2(mQty * mCost) });
      } else {
        const p = prodMap.get(pid) as any;
        if (!p) return NextResponse.json({ error: `Línea ${idx + 1}: producto inválido` }, { status: 400 });
        items.push({ kind: "product", product_id: pid, qty: mQty, unit_cost: mCost, line_total: round2(mQty * mCost) });
      }
      continue;
    }
    const iid = String(raw?.ingredient_id || "");
    const ing = ingMap.get(iid);
    if (!ing) return NextResponse.json({ error: `LÃ­nea ${idx + 1}: insumo invÃ¡lido` }, { status: 400 });
    const qty = Number(raw?.qty);
    if (!isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: `LÃ­nea ${idx + 1} (â€œ${ing.name}â€): cantidad invÃ¡lida` }, { status: 400 });
    }
    const unitCostLine = Number(raw?.unit_cost);
    if (!isFinite(unitCostLine) || unitCostLine < 0) {
      return NextResponse.json({ error: `LÃ­nea ${idx + 1} (â€œ${ing.name}â€): costo invÃ¡lido` }, { status: 400 });
    }
    const unit = String(raw?.unit || ing.base_unit).trim();
    const factor = unitFactor(unit, ing.base_unit);
    if (factor === null) {
      return NextResponse.json(
        { error: `LÃ­nea ${idx + 1} (â€œ${ing.name}â€): la unidad â€œ${unit}â€ no es compatible con â€œ${ing.base_unit}â€` },
        { status: 400 }
      );
    }
    const qtyBase = qty * factor;
    const unitCostNet = round4(unitCostLine / factor);
    items.push({
      kind: "ingredient",
      ingredient_id: iid,
      qty,
      unit,
      unit_cost: unitCostLine,
      qty_base: qtyBase,
      unit_cost_net: unitCostNet,
      line_total: round2(qtyBase * unitCostNet),
    });
  }

  const total = round2(items.reduce((s, i) => s + i.line_total, 0));

  let purchaseId: string;
  try {
    purchaseId = await withTransaction(async (tx) => {
    const p = await tx.queryOne<{ id: string }>(
      `INSERT INTO purchases (vendor_id, supplier_id, purchased_at, receipt_type, receipt_number, notes, total)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7) RETURNING id`,
      [gate.vendor.id, supplier_id, purchased_at, receipt_type, receipt_number, notes, total]
    );
    if (!p) throw new Error("No se pudo crear la compra");
    const { logStockMovement } = await import("@/lib/stock-ledger");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "product" || it.kind === "variant") {
        const pid = it.kind === "product" ? it.product_id : it.product_id;
        const vid = it.kind === "variant" ? it.variant_id : null;
        await tx.queryVoid(
          `INSERT INTO purchase_items (purchase_id, ingredient_id, product_id, variant_id, qty, unit, unit_cost_net, line_total, position)
           VALUES ($1, NULL, $2, $3, $4, 'u', $5, $6, $7)`,
          [p.id, pid, vid, it.qty, it.unit_cost, it.line_total, i]
        );
        if (it.kind === "product") {
          // Entra stock + actualiza último/promedio en la misma sentencia.
          // Casts ::numeric explícitos: sin ellos Postgres no unifica el tipo
          // de los parámetros ($3 en contexto entero y numérico → 42P08).
          await tx.queryVoid(
            `UPDATE products SET stock = COALESCE(stock, 0) + $2, stock_control = true,
              cost_last = $3::numeric,
              cost_avg = CASE WHEN COALESCE(stock, 0) > 0 AND cost_avg IS NOT NULL
                THEN ROUND((cost_avg * stock + $3::numeric * $2) / (stock + $2), 2) ELSE $3::numeric END
             WHERE id = $1`,
            [pid, it.qty, it.unit_cost]
          );
        } else {
          await tx.queryVoid(
            `UPDATE product_variants SET stock = COALESCE(stock, 0) + $2, cost_last = $3::numeric WHERE id = $1`,
            [vid, it.qty, it.unit_cost]
          );
        }
        await logStockMovement(tx, {
          vendorId: gate.vendor.id,
          product_id: pid,
          variant_id: vid,
          qty_delta: it.qty,
          reason: "compra",
          ref_purchase: p.id,
        });
        // Precio del proveedor (para cotizar y comparar).
        if (supplier_id) {
          const existing = await tx.queryOne<{ id: string }>(
            `SELECT id FROM supplier_pricelists WHERE supplier_id = $1
             AND COALESCE(product_id::text, '') = COALESCE($2::text, '')
             AND COALESCE(variant_id::text, '') = COALESCE($3::text, '')
             AND ingredient_id IS NULL LIMIT 1`,
            [supplier_id, pid, vid]
          );
          if (existing) {
            await tx.queryVoid(
              `UPDATE supplier_pricelists SET price = $1, unit = 'u', updated_at = now() WHERE id = $2`,
              [it.unit_cost, existing.id]
            );
          } else {
            await tx.queryVoid(
              `INSERT INTO supplier_pricelists (supplier_id, vendor_id, product_id, variant_id, price, unit)
               VALUES ($1, $2, $3, $4, $5, 'u')`,
              [supplier_id, gate.vendor.id, pid, vid, it.unit_cost]
            );
          }
        }
        continue;
      }
      await tx.queryVoid(
        `INSERT INTO purchase_items (purchase_id, ingredient_id, qty, unit, unit_cost_net, line_total, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.id, it.ingredient_id, it.qty, it.unit, it.unit_cost_net, it.line_total, i]
      );
      // Último costo: la compra pisa el costo del insumo.
      await tx.queryVoid(
        `UPDATE ingredients SET cost_per_unit = $1, updated_at = now() WHERE id = $2`,
        [it.unit_cost_net, it.ingredient_id]
      );
      // Precio del proveedor (para comparar y cotizar).
      if (supplier_id) {
        const existing = await tx.queryOne<{ id: string }>(
          `SELECT id FROM supplier_pricelists WHERE supplier_id = $1 AND ingredient_id = $2
           AND product_id IS NULL AND variant_id IS NULL LIMIT 1`,
          [supplier_id, it.ingredient_id]
        ).catch(() => null);
        if (existing) {
          await tx.queryVoid(
            `UPDATE supplier_pricelists SET price = $1, unit = $2, updated_at = now() WHERE id = $3`,
            [it.unit_cost_net, it.unit, existing.id]
          );
        } else {
          await tx.queryVoid(
            `INSERT INTO supplier_pricelists (supplier_id, vendor_id, ingredient_id, price, unit)
             VALUES ($1, $2, $3, $4, $5)`,
            [supplier_id, gate.vendor.id, it.ingredient_id, it.unit_cost_net, it.unit]
          ).catch(() => null);
        }
      }
    }
    return p.id as string;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // Tablas/columnas de inventario sin migrar → mensaje accionable (no 500 mudo).
    if (/relation .* does not exist|column .* does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración de inventario en la base de datos", code: "migration_pending" },
        { status: 503 }
      );
    }
    // Cualquier otro 500 queda en docker logs con contexto (no mudo).
    const { logApiError } = await import("@/lib/api-error");
    logApiError("purchases/post", e);
    throw e;
  }

  return NextResponse.json({ purchase_id: purchaseId, total });
}
