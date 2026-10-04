import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** DELETE /api/vendor/waitlist/[id] — quitar de la lista (atendida/vencida). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica" && gate.vendor.vertical !== "servicio") {
    return NextResponse.json({ error: "No disponible" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await queryOne(`DELETE FROM waitlist WHERE id = $1 AND vendor_id = $2`, [id, gate.vendor.id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-growth.sql en la base" },
      { status: 503 }
    );
  }
}
