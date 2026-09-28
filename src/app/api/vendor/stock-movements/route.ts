import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

/**
 * Kardex: movimientos con nombre del target.
 * Query: ?product_id=&variant_id=&reason=&limit= (default 100, máx 500).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id");
  const variantId = url.searchParams.get("variant_id");
  const reason = url.searchParams.get("reason");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const conds = ["m.vendor_id = $1"];
  const vals: unknown[] = [gate.vendor.id];
  if (productId) {
    vals.push(productId);
    conds.push(`m.product_id = $${vals.length}`);
  }
  if (variantId) {
    vals.push(variantId);
    conds.push(`m.variant_id = $${vals.length}`);
  }
  if (reason) {
    vals.push(reason);
    conds.push(`m.reason = $${vals.length}`);
  }
  const rows = await queryMany<Record<string, unknown>>(
    `SELECT m.*, p.name AS product_name, v.color AS variant_color, v.talle AS variant_talle
     FROM stock_ledger m
     LEFT JOIN products p ON p.id = m.product_id
     LEFT JOIN product_variants v ON v.id = m.variant_id
     WHERE ${conds.join(" AND ")}
     ORDER BY m.created_at DESC LIMIT ${limit}`,
    vals
  ).catch(() => []);
  return NextResponse.json({ movements: rows || [] });
}
