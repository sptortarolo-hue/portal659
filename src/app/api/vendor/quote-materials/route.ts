import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Memoria de precios de materiales: últimas descripciones usadas por el
 * comercio con su precio unitario (para cotizar rápido y consistente).
 * GET /api/vendor/quote-materials → { materials: [{ description, unit_price }] }
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  const rows = await queryMany<{ description: string; unit_price: number }>(
    `SELECT i.description, i.unit_price FROM quote_items i
     JOIN quotes q ON q.id = i.quote_id
     WHERE q.vendor_id = $1 AND i.kind = 'material' AND i.description <> ''
     ORDER BY q.created_at DESC LIMIT 200`,
    [gate.vendor.id]
  ).catch(() => []);
  const seen = new Set<string>();
  const materials: { description: string; unit_price: number }[] = [];
  for (const r of rows || []) {
    const key = String(r.description || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    materials.push({ description: String(r.description).trim(), unit_price: Number(r.unit_price) || 0 });
    if (materials.length >= 100) break;
  }
  return NextResponse.json({ materials });
}
