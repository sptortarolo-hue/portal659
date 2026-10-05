import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

/** Detalle de una compra con sus líneas. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes") && !gate.plan.can("inventory")) {
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
    `SELECT i.*, g.name AS ingredient_name, g.base_unit AS ingredient_unit,
            p.name AS product_name, v.color AS variant_color, v.talle AS variant_talle
     FROM purchase_items i
     LEFT JOIN ingredients g ON g.id = i.ingredient_id
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN product_variants v ON v.id = i.variant_id
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
  if (!gate.plan.can("recipes") && !gate.plan.can("inventory")) {
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
    `SELECT DISTINCT ingredient_id FROM purchase_items WHERE purchase_id = $1 AND ingredient_id IS NOT NULL`,
    [id]
  ).then((r) => (r || []).map((x) => x.ingredient_id));
  // Mercadería de la compra (para restar el stock que entró + revertir costo).
  const merchLines = await queryMany<Record<string, any>>(
    `SELECT product_id, variant_id, qty FROM purchase_items WHERE purchase_id = $1 AND ingredient_id IS NULL`,
    [id]
  ).then((r) => r || []);

  const result: { ingredient_id: string; cost_per_unit: number | null }[] = [];
  const { logStockMovement } = await import("@/lib/stock-ledger");
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
    // Mercadería: resta el stock que entró, revierte cost_last/cost_avg a la
    // compra anterior (o NULL) y deja rastro en kardex (razón compra negativa).
    for (const m of merchLines) {
      const mq = Math.floor(Number(m.qty)) || 0;
      if (m.variant_id) {
        if (mq > 0) {
          await tx.queryVoid(`UPDATE product_variants SET stock = GREATEST(0, stock - $1) WHERE id = $2`, [mq, m.variant_id]);
          await logStockMovement(tx, { vendorId: gate.vendor.id, variant_id: String(m.variant_id), qty_delta: -mq, reason: "compra", ref_purchase: id });
        }
        const prev = await tx.queryOne<{ unit_cost_net: number }>(
          `SELECT i.unit_cost_net FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
           WHERE i.variant_id = $1 AND p.vendor_id = $2
           ORDER BY p.purchased_at DESC, i.created_at DESC LIMIT 1`,
          [m.variant_id, gate.vendor.id]
        ).catch(() => null);
        await tx.queryVoid(`UPDATE product_variants SET cost_last = $1 WHERE id = $2`, [prev ? prev.unit_cost_net : null, m.variant_id]);
      } else if (m.product_id) {
        if (mq > 0) {
          await tx.queryVoid(`UPDATE products SET stock = GREATEST(0, COALESCE(stock, 0) - $1) WHERE id = $2`, [mq, m.product_id]);
          await logStockMovement(tx, { vendorId: gate.vendor.id, product_id: String(m.product_id), qty_delta: -mq, reason: "compra", ref_purchase: id });
        }
        const prev = await tx.queryOne<{ unit_cost_net: number }>(
          `SELECT i.unit_cost_net FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
           WHERE i.product_id = $1 AND i.variant_id IS NULL AND p.vendor_id = $2
           ORDER BY p.purchased_at DESC, i.created_at DESC LIMIT 1`,
          [m.product_id, gate.vendor.id]
        ).catch(() => null);
        await tx.queryVoid(`UPDATE products SET cost_last = $1 WHERE id = $2`, [prev ? prev.unit_cost_net : null, m.product_id]);
        // Recalcula el promedio ponderado con el historial restante (o NULL).
        try {
          const avg = await tx.queryOne<{ avg: number | null; tot: number | null }>(
            `SELECT ROUND(SUM(i.qty * i.unit_cost_net) / NULLIF(SUM(i.qty), 0), 2) AS avg,
                    SUM(i.qty) AS tot
             FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
             WHERE i.product_id = $1 AND i.variant_id IS NULL AND p.vendor_id = $2`,
            [m.product_id, gate.vendor.id]
          );
          await tx.queryVoid(`UPDATE products SET cost_avg = $1 WHERE id = $2`, [
            avg && avg.tot != null && Number(avg.tot) > 0 ? avg.avg : null,
            m.product_id,
          ]);
        } catch {
          /* columna cost_avg sin migrar: se omite */
        }
      }
    }
  });

  return NextResponse.json({ ok: true, reverted: result });
}
