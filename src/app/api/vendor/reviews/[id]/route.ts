import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  if (!gate.plan.can("reviews_manage")) {
    return NextResponse.json(
      { error: "Responder reseñas requiere un plan pago (Pedidos, Gestión integral u Oficios)." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json();
  const { reply } = body;

  if (typeof reply !== "string" || reply.trim().length === 0) {
    return NextResponse.json({ error: "Escribí una respuesta" }, { status: 400 });
  }
  if (reply.trim().length > 600) {
    return NextResponse.json({ error: "La respuesta es muy larga (máx. 600 caracteres)" }, { status: 400 });
  }

  const review = await queryOne<{ id: string }>(
    `SELECT id FROM reviews WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );

  if (!review) return NextResponse.json({ error: "Reseña no encontrada" }, { status: 404 });

  await queryOne(
    `UPDATE reviews SET reply = $1, reply_by = $2, replied_at = $3 WHERE id = $4`,
    [reply.trim(), gate.vendor.store_name, new Date().toISOString(), id]
  );

  return NextResponse.json({ ok: true });
}