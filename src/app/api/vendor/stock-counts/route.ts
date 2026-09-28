import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

/** Lista conteos (más recientes primero). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const counts = await queryMany<Record<string, unknown>>(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = c.id) AS lines_count
     FROM stock_counts c WHERE c.vendor_id = $1
     ORDER BY c.created_at DESC LIMIT 50`,
    [gate.vendor.id]
  ).catch(() => []);
  return NextResponse.json({ counts: counts || [] });
}

/**
 * Abre un conteo con snapshot del sistema.
 * Body: { items: [{ product_id?, variant_id? }] } (al menos 1).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const pids = Array.from(
    new Set(rawItems.map((i: any) => String(i?.product_id || "")).filter(Boolean))
  ) as string[];
  const vids = Array.from(
    new Set(rawItems.map((i: any) => String(i?.variant_id || "")).filter(Boolean))
  ) as string[];
  if (pids.length === 0 && vids.length === 0) {
    return NextResponse.json({ error: "Indicá al menos un producto o variante" }, { status: 400 });
  }
  const prows = pids.length
    ? await queryMany<{ id: string; stock: number | null }>(
        `SELECT id, stock FROM products WHERE id = ANY($1) AND vendor_id = $2`,
        [pids, gate.vendor.id]
      )
    : [];
  const vrows = vids.length
    ? await queryMany<{ id: string; stock: number }>(
        `SELECT v.id, v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ANY($1) AND p.vendor_id = $2`,
        [vids, gate.vendor.id]
      )
    : [];
  if ((prows || []).length + (vrows || []).length === 0) {
    return NextResponse.json({ error: "Ningún ítem válido" }, { status: 400 });
  }
  const countId = await withTransaction(async (tx) => {
    const c = await tx.queryOne<{ id: string }>(
      `INSERT INTO stock_counts (vendor_id, status, created_by) VALUES ($1, 'abierto', $2) RETURNING id`,
      [gate.vendor.id, gate.user.id || null]
    );
    if (!c) throw new Error("No se pudo abrir el conteo");
    for (const p of prows || []) {
      await tx.queryVoid(
        `INSERT INTO stock_count_lines (count_id, product_id, system_qty) VALUES ($1, $2, $3)`,
        [c.id, p.id, Number(p.stock) || 0]
      );
    }
    for (const v of vrows || []) {
      await tx.queryVoid(
        `INSERT INTO stock_count_lines (count_id, variant_id, system_qty) VALUES ($1, $2, $3)`,
        [c.id, v.id, Number(v.stock) || 0]
      );
    }
    return c.id as string;
  }).catch(() => null);
  if (!countId) {
    return NextResponse.json({ error: "No se pudo abrir el conteo (¿migración pendiente?)" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, count_id: countId });
}
