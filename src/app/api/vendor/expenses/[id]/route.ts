import { gateRequest, gateError } from "@/lib/subscription-gate";
import { query, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** Elimina un gasto manual (los automáticos se corrigen desde su origen). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "Los gastos forman parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const row = await queryOne<{ source: string }>(
    `SELECT source FROM expenses WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  ).catch(() => null);
  if (!row) return NextResponse.json({ error: "Gasto no encontrado" }, { status: 404 });
  if (row.source !== "manual") {
    return NextResponse.json(
      { error: "Los gastos automáticos se corrigen desde su origen (caja o compra)" },
      { status: 400 }
    );
  }
  await query(`DELETE FROM expenses WHERE id = $1 AND vendor_id = $2`, [id, gate.vendor.id]);
  return NextResponse.json({ ok: true });
}
