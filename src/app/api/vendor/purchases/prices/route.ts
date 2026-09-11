import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Las recetas forman parte del plan Gestión integral";

/** Historial de precios de un insumo (?ingredientId=): serie para ver la
 *  variación del costo en el tiempo. */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const ingredientId = searchParams.get("ingredientId");
  if (!ingredientId) {
    return NextResponse.json({ error: "Falta ingredientId" }, { status: 400 });
  }

  const ing = await queryOne<{ id: string }>(
    `SELECT id FROM ingredients WHERE id = $1 AND vendor_id = $2`,
    [ingredientId, gate.vendor.id]
  );
  if (!ing) return NextResponse.json({ error: "Insumo no encontrado" }, { status: 404 });

  const history = await queryMany<Record<string, unknown>>(
    `SELECT p.purchased_at, p.receipt_type, s.name AS supplier_name,
            i.qty, i.unit, i.unit_cost_net, i.line_total
     FROM purchase_items i
     JOIN purchases p ON p.id = i.purchase_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE i.ingredient_id = $1 AND p.vendor_id = $2
     ORDER BY p.purchased_at DESC, i.created_at DESC
     LIMIT 50`,
    [ingredientId, gate.vendor.id]
  );
  return NextResponse.json({ history: history || [] });
}
