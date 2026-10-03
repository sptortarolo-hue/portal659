import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * POST /api/vendor/bookings/[id]/token
 * Genera (o regenera) el link público de confirmación del turno
 * (/turno/[token]). Devuelve la URL relativa para copiar/enviar por WA.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "servicio" && gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para servicios y estética" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const row = await queryOne<{ confirm_token: string | null }>(
      `UPDATE bookings SET confirm_token = COALESCE(confirm_token, $2)
       WHERE id = $1 AND vendor_id = $3
       RETURNING confirm_token`,
      [id, crypto.randomBytes(16).toString("hex"), gate.vendor.id]
    );
    if (!row?.confirm_token) {
      return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ token: row.confirm_token, url: `/turno/${row.confirm_token}` });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-confirm-token.sql en la base" },
      { status: 503 }
    );
  }
}
