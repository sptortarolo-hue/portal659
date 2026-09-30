import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  if (!gate.plan.can("reviews_manage")) {
    return NextResponse.json(
      { error: "Reportar reseñas requiere un plan pago (Pedidos, Gestión integral u Oficios)." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json();
  const { reason } = body;

  if (typeof reason !== "string" || reason.trim().length === 0) {
    return NextResponse.json({ error: "Indicá el motivo del reporte" }, { status: 400 });
  }
  if (reason.trim().length > 500) {
    return NextResponse.json({ error: "El motivo es muy largo (máx. 500 caracteres)" }, { status: 400 });
  }

  const review = await queryOne<{ id: string; reported: boolean }>(
    `SELECT id, reported FROM reviews WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );

  if (!review) return NextResponse.json({ error: "Reseña no encontrada" }, { status: 404 });
  if (review.reported) {
    return NextResponse.json({ error: "Esta reseña ya fue reportada" }, { status: 400 });
  }

  await queryOne(
    `UPDATE reviews SET reported = TRUE, reported_at = $1, report_reason = $2 WHERE id = $3`,
    [new Date().toISOString(), reason.trim(), id]
  );

  return NextResponse.json({ ok: true });
}