import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
const GATE_MSG = "La administración de precios forma parte del plan Gestión integral";

/** Asigna (o quita) la lista de margen a un lote de productos. */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.productIds) ? body.productIds.map(String).filter(Boolean) : [];
  if (ids.length === 0) return NextResponse.json({ ok: false, error: "Sin productos" }, { status: 400 });
  const listId = body?.listId ? String(body.listId) : null;
  const reason = body?.reason != null && String(body.reason).trim() ? String(body.reason).trim() : "Precio manual";

  if (listId) {
    const list = await queryOne<{ id: string }>(
      `SELECT id FROM margin_lists WHERE id=$1 AND vendor_id=$2 LIMIT 1`,
      [listId, gate.vendor.id]
    ).catch(() => null);
    if (!list) return NextResponse.json({ ok: false, error: "Lista no encontrada" }, { status: 404 });
  }

  const cols = await queryMany<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='products'
        AND column_name IN ('margin_list_id','price_source','pricing_skipped')`
  ).catch(() => []);
  const has = (c: string) => cols.some((x) => x.column_name === c);

  await withTransaction(async (tx) => {
    for (const id of ids) {
      if (has("margin_list_id")) {
        await tx.queryVoid(`UPDATE products SET margin_list_id=$2 WHERE id=$1 AND vendor_id=$3`, [id, listId, gate.vendor.id]);
      }
      if (has("price_source")) {
        await tx.queryVoid(`UPDATE products SET price_source=$2 WHERE id=$1 AND vendor_id=$3`, [id, listId ? "lista" : "manual", gate.vendor.id]);
      }
      if (has("pricing_skipped")) {
        await tx.queryVoid(
          `UPDATE products SET pricing_skipped=$2::jsonb WHERE id=$1 AND vendor_id=$3`,
          [id, JSON.stringify(listId ? {} : { list: reason }), gate.vendor.id]
        );
      }
    }
  });

  return NextResponse.json({ ok: true, updated: ids.length });
}
