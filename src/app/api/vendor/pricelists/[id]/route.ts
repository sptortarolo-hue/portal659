import { gateRequest, gateError } from "@/lib/subscription-gate";
import { query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Borra un precio de proveedor. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("recipes") && !gate.plan.can("inventory")) {
    return NextResponse.json(
      { error: "Compras e inventario forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }
  const params = await context.params;
  await query(`DELETE FROM supplier_pricelists WHERE id = $1 AND vendor_id = $2`, [
    params.id,
    gate.vendor.id,
  ]);
  return NextResponse.json({ ok: true });
}
