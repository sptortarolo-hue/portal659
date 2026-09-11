import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { unitFactor } from "@/lib/costing";
import { NextResponse } from "next/server";
import type { Ingredient, ReceiptType } from "@/types/database";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

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

/** Lista de compras (más recientes primero, con proveedor y cantidad de líneas). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
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

type InItem = { ingredient_id: string; qty: number; unit: string; unit_cost: number };

/**
 * Registra una compra y actualiza el costo de cada insumo al ÚLTIMO precio
 * neto (los platos se recalculan solos porque el costo es derivado).
 * Body: { supplier_id?, purchased_at?, receipt_type?, receipt_number?, notes?,
 *         items: [{ ingredient_id, qty, unit, unit_cost }] }
 * donde unit_cost = costo neto por unidad DE LA LÍNEA (ej. $/kg si unit=kg).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
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
    return NextResponse.json({ error: "Fecha inválida (usá AAAA-MM-DD)" }, { status: 400 });
  }
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ error: "La compra necesita al menos una línea" }, { status: 400 });
  }

  const ingIds = Array.from(
    new Set((rawItems as any[]).map((i) => String(i?.ingredient_id || "")).filter(Boolean))
  );
  if (ingIds.length === 0) {
    return NextResponse.json({ error: "La compra necesita al menos un insumo válido" }, { status: 400 });
  }
  const ings = await queryMany<Ingredient>(
    `SELECT * FROM ingredients WHERE id = ANY($1) AND vendor_id = $2`,
    [ingIds, gate.vendor.id]
  );
  const ingMap = new Map((ings || []).map((i) => [i.id, i]));

  // Normalizar + validar líneas (conversión a unidad base).
  const items: (InItem & { qty_base: number; unit_cost_net: number; line_total: number })[] = [];
  for (let idx = 0; idx < (rawItems as any[]).length; idx++) {
    const raw = (rawItems as any[])[idx];
    const iid = String(raw?.ingredient_id || "");
    const ing = ingMap.get(iid);
    if (!ing) return NextResponse.json({ error: `Línea ${idx + 1}: insumo inválido` }, { status: 400 });
    const qty = Number(raw?.qty);
    if (!isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: `Línea ${idx + 1} (“${ing.name}”): cantidad inválida` }, { status: 400 });
    }
    const unitCostLine = Number(raw?.unit_cost);
    if (!isFinite(unitCostLine) || unitCostLine < 0) {
      return NextResponse.json({ error: `Línea ${idx + 1} (“${ing.name}”): costo inválido` }, { status: 400 });
    }
    const unit = String(raw?.unit || ing.base_unit).trim();
    const factor = unitFactor(unit, ing.base_unit);
    if (factor === null) {
      return NextResponse.json(
        { error: `Línea ${idx + 1} (“${ing.name}”): la unidad “${unit}” no es compatible con “${ing.base_unit}”` },
        { status: 400 }
      );
    }
    const qtyBase = qty * factor;
    const unitCostNet = round4(unitCostLine / factor);
    items.push({
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

  const purchaseId = await withTransaction(async (tx) => {
    const p = await tx.queryOne<{ id: string }>(
      `INSERT INTO purchases (vendor_id, supplier_id, purchased_at, receipt_type, receipt_number, notes, total)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7) RETURNING id`,
      [gate.vendor.id, supplier_id, purchased_at, receipt_type, receipt_number, notes, total]
    );
    if (!p) throw new Error("No se pudo crear la compra");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
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
    }
    return p.id as string;
  });

  return NextResponse.json({ purchase_id: purchaseId, total });
}
