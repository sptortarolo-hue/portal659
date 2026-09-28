import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Partidas de un presupuesto del comercio (para el doc A4/PDF). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { id } = await params;
  const quote = await queryOne<{ id: string }>(
    `SELECT id FROM quotes WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!quote) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const items = await queryMany<Record<string, unknown>>(
    `SELECT id, kind, description, qty, unit_price, position
     FROM quote_items WHERE quote_id = $1 ORDER BY position ASC`,
    [id]
  ).catch(() => []);
  return NextResponse.json({ items: items || [] });
}
