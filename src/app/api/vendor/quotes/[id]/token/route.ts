import { randomBytes } from "crypto";
import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Devuelve el public_token del presupuesto (y lo genera si no existe).
 * Lo usa el panel al compartir por WhatsApp: el link permite al cliente
 * aceptar el presupuesto y seguir el estado de la orden.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  // Tolerante a migración sin aplicar: nunca romper el flujo de compartir.
  const col = await queryOne(
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'public_token' LIMIT 1`
  ).catch(() => null);
  if (!col) {
    return NextResponse.json(
      { error: "Falta migración migrate-quote-public-token.sql (el mensaje sale sin link)" },
      { status: 503 }
    );
  }

  const quote = await queryOne<{ id: string; public_token: string | null }>(
    `SELECT id, public_token FROM quotes WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!quote) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (quote.public_token) {
    return NextResponse.json({ token: quote.public_token });
  }

  // Generar con reintento (colisión prácticamente imposible).
  for (let i = 0; i < 3; i++) {
    const token = randomBytes(24).toString("hex");
    const rows = await queryOne<{ public_token: string }>(
      `UPDATE quotes SET public_token = $1 WHERE id = $2 AND public_token IS NULL RETURNING public_token`,
      [token, id]
    ).catch(() => null);
    if (rows) return NextResponse.json({ token: rows.public_token });
    // Si otra request lo generó primero, devolver el existente.
    const existing = await queryOne<{ public_token: string | null }>(
      `SELECT public_token FROM quotes WHERE id = $1 LIMIT 1`,
      [id]
    ).catch(() => null);
    if (existing?.public_token) return NextResponse.json({ token: existing.public_token });
  }
  return NextResponse.json({ error: "No se pudo generar el link" }, { status: 500 });
}
