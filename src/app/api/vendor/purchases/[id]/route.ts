import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Detalle de una compra con sus líneas. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { id } = await params;
  const purchase = await queryOne<Record<string, unknown>>(
    `SELECT p.*, s.name AS supplier_name
     FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = $1 AND p.vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (!purchase) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });

  const items = await queryMany<Record<string, unknown>>(
    `SELECT i.*, g.name AS ingredient_name, g.base_unit AS ingredient_unit
     FROM purchase_items i JOIN ingredients g ON g.id = i.ingredient_id
     WHERE i.purchase_id = $1 ORDER BY i.position ASC`,
    [id]
  );
  return NextResponse.json({ purchase, items: items || [] });
}

/** Borra una compra y revierte el costo de cada insumo al de su compra
 *  anterior vigente (si no hay anterior, se conserva el costo actual para
 *  no destruir información). */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { id } = await params;
  const purchase = await queryOne<{ id: string }>(
    `SELECT id FROM purchases WHERE id = $1 AND vendor_id = $2`,
    [id, gate.vendor.id]
  );
  if (!purchase) return NextResponse.json({ error: "Compra no encontrada" }, { status: 404 });

  // Nota: tx solo expone queryOne/queryVoid; las lecturas van con queryMany
  // fuera de la transacción (mismo pool, suficiente para este caso).
  const ingIds = await queryMany<{ ingredient_id: string }>(
    `SELECT DISTINCT ingredient_id FROM purchase_items WHERE purchase_id = $1`,
    [id]
  ).then((r) => (r || []).map((x) => x.ingredient_id));

  const result: { ingredient_id: string; cost_per_unit: number | null }[] = [];
  await withTransaction(async (tx) => {
    await tx.queryVoid(`DELETE FROM purchases WHERE id = $1`, [id]);
    for (const iid of ingIds) {
      const prev = await tx.queryOne<{ unit_cost_net: number }>(
        `SELECT i.unit_cost_net
         FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
         WHERE i.ingredient_id = $1 AND p.vendor_id = $2
         ORDER BY p.purchased_at DESC, i.created_at DESC
         LIMIT 1`,
        [iid, gate.vendor.id]
      );
      if (prev) {
        await tx.queryVoid(
          `UPDATE ingredients SET cost_per_unit = $1, updated_at = now() WHERE id = $2`,
          [prev.unit_cost_net, iid]
        );
        result.push({ ingredient_id: iid, cost_per_unit: Number(prev.unit_cost_net) });
      } else {
        result.push({ ingredient_id: iid, cost_per_unit: null });
      }
    }
  });

  return NextResponse.json({ ok: true, reverted: result });
}
