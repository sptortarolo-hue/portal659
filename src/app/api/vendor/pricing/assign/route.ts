import { NextResponse } from "next/server";
import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
const GATE_MSG = "La administración de precios forma parte del plan Gestión integral";

type AssignGroup = { productIds: string[]; listId: string | null; reason: string };

/**
 * Asigna la lista de margen a uno o varios grupos de productos.
 * Body legado: { productIds, listId, reason }
 * Body multi-grupo: { groups: [{ productIds, listId, reason }, ...] }
 * Un producto pertenece a una sola lista: si aparece en dos grupos, gana el último.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!(gate.plan.can("inventory") || gate.plan.can("recipes"))) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));

  const rawGroups: AssignGroup[] = Array.isArray(body?.groups)
    ? body.groups
        .filter((g: any) => g && Array.isArray(g.productIds) && g.productIds.length > 0)
        .map((g: any) => ({
          productIds: g.productIds.map(String).filter(Boolean),
          listId: g.listId ? String(g.listId) : null,
          reason: g.reason != null && String(g.reason).trim() ? String(g.reason).trim() : "Precio manual",
        }))
    : [
        {
          productIds: Array.isArray(body?.productIds) ? body.productIds.map(String).filter(Boolean) : [],
          listId: body?.listId ? String(body.listId) : null,
          reason: body?.reason != null && String(body.reason).trim() ? String(body.reason).trim() : "Precio manual",
        },
      ];

  if (rawGroups.length === 0 || rawGroups.every((g) => g.productIds.length === 0)) {
    return NextResponse.json({ ok: false, error: "Sin productos" }, { status: 400 });
  }

  // Validar todas las listas antes de escribir.
  const listIds = [...new Set(rawGroups.map((g) => g.listId).filter(Boolean) as string[])];
  for (const listId of listIds) {
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

  // Un producto = una sola lista (último grupo gana).
  const assignments = new Map<string, { listId: string | null; reason: string }>();
  for (const g of rawGroups) {
    for (const id of g.productIds) assignments.set(id, { listId: g.listId, reason: g.reason });
  }

  await withTransaction(async (tx) => {
    for (const [id, a] of assignments) {
      if (has("margin_list_id")) {
        await tx.queryVoid(`UPDATE products SET margin_list_id=$2 WHERE id=$1 AND vendor_id=$3`, [id, a.listId, gate.vendor.id]);
      }
      if (has("price_source")) {
        await tx.queryVoid(`UPDATE products SET price_source=$2 WHERE id=$1 AND vendor_id=$3`, [id, a.listId ? "lista" : "manual", gate.vendor.id]);
      }
      if (has("pricing_skipped")) {
        await tx.queryVoid(
          `UPDATE products SET pricing_skipped=$2::jsonb WHERE id=$1 AND vendor_id=$3`,
          [id, JSON.stringify(a.listId ? {} : { list: a.reason }), gate.vendor.id]
        );
      }
    }
  });

  return NextResponse.json({ ok: true, updated: assignments.size, groups: rawGroups.length });
}
