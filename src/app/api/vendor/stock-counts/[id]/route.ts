import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { logStockMovement } from "@/lib/stock-ledger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

async function getCount(vendorId: string, id: string) {
  return queryOne<Record<string, any>>(
    `SELECT * FROM stock_counts WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendorId]
  ).catch(() => null);
}

/** Detalle del conteo con líneas + nombres. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const params = await context.params;
  const count = await getCount(gate.vendor.id, params.id);
  if (!count) return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 });
  const lines = await queryMany<Record<string, any>>(
    `SELECT l.*, p.name AS product_name, p.stock_control,
            v.color AS variant_color, v.talle AS variant_talle
     FROM stock_count_lines l
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN product_variants v ON v.id = l.variant_id
     WHERE l.count_id = $1 ORDER BY l.id ASC`,
    [params.id]
  ).catch(() => []);
  return NextResponse.json({ count, lines: lines || [] });
}

/**
 * Carga conteos: { lines: [{ id?, product_id?, variant_id?, counted_qty?, note? }] }.
 * Solo en conteos abiertos.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const params = await context.params;
  const count = await getCount(gate.vendor.id, params.id);
  if (!count) return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 });
  if (count.status !== "abierto") {
    return NextResponse.json({ error: "El conteo ya está cerrado" }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  await withTransaction(async (tx) => {
    for (const l of lines) {
      const counted =
        l?.counted_qty === null || l?.counted_qty === undefined || l?.counted_qty === ""
          ? null
          : Math.floor(Number(l.counted_qty));
      if (counted !== null && (!Number.isFinite(counted) || counted < 0)) continue;
      if (l?.id) {
        await tx.queryVoid(
          `UPDATE stock_count_lines SET counted_qty = $1, note = $2
           WHERE id = $3 AND count_id = $4`,
          [counted, typeof l?.note === "string" ? l.note.slice(0, 200) : null, l.id, params.id]
        );
      } else if (l?.product_id || l?.variant_id) {
        // Snapshot del sistema al agregar la línea.
        let system = 0;
        if (l.variant_id) {
          const v = await tx.queryOne<{ stock: number }>(
            `SELECT v.stock FROM product_variants v JOIN products p ON p.id = v.product_id
             WHERE v.id = $1 AND p.vendor_id = $2`,
            [l.variant_id, gate.vendor.id]
          );
          system = Number(v?.stock) || 0;
        } else {
          const p = await tx.queryOne<{ stock: number | null }>(
            `SELECT stock FROM products WHERE id = $1 AND vendor_id = $2`,
            [l.product_id, gate.vendor.id]
          );
          system = Number(p?.stock) || 0;
        }
        await tx.queryVoid(
          `INSERT INTO stock_count_lines (count_id, product_id, variant_id, system_qty, counted_qty, note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            params.id,
            l.product_id || null,
            l.variant_id || null,
            system,
            counted,
            typeof l?.note === "string" ? l.note.slice(0, 200) : null,
          ]
        );
      }
    }
  }).catch(() => null);
  return NextResponse.json({ ok: true });
}

/**
 * Cierra el conteo: aplica diferencias al stock + kardex 'conteo'.
 * Body: { action: "close" }.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const params = await context.params;
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "close") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }
  const count = await getCount(gate.vendor.id, params.id);
  if (!count) return NextResponse.json({ error: "Conteo no encontrado" }, { status: 404 });
  if (count.status !== "abierto") {
    return NextResponse.json({ error: "El conteo ya está cerrado" }, { status: 400 });
  }
  const lines = await queryMany<Record<string, any>>(
    `SELECT * FROM stock_count_lines WHERE count_id = $1 AND counted_qty IS NOT NULL`,
    [params.id]
  ).catch(() => []);
  let applied = 0;
  let activated = 0;
  await withTransaction(async (tx) => {
    for (const l of lines || []) {
      const diff = Math.floor(Number(l.counted_qty)) - Math.floor(Number(l.system_qty) || 0);
      if (!Number.isFinite(diff) || diff === 0) continue;
      if (l.variant_id) {
        await tx.queryVoid(`UPDATE product_variants SET stock = $1 WHERE id = $2`, [
          Math.max(0, Math.floor(Number(l.counted_qty))),
          l.variant_id,
        ]);
        await logStockMovement(tx, {
          vendorId: gate.vendor.id,
          variant_id: String(l.variant_id),
          qty_delta: diff,
          reason: "conteo",
          ref_count: params.id,
          created_by: gate.user.id || null,
        });
        applied++;
      } else if (l.product_id) {
        // Solo prende control de stock si estaba apagado (avisado en la respuesta).
        const was = await tx.queryOne<{ stock_control: boolean | null }>(
          `SELECT stock_control FROM products WHERE id = $1`,
          [l.product_id]
        ).catch(() => null);
        await tx.queryVoid(
          `UPDATE products SET stock = $1, stock_control = true WHERE id = $2`,
          [Math.max(0, Math.floor(Number(l.counted_qty))), l.product_id]
        );
        if (was && was.stock_control !== true) activated++;
        await logStockMovement(tx, {
          vendorId: gate.vendor.id,
          product_id: String(l.product_id),
          qty_delta: diff,
          reason: "conteo",
          ref_count: params.id,
          created_by: gate.user.id || null,
        });
        applied++;
      }
    }
    await tx.queryVoid(
      `UPDATE stock_counts SET status = 'cerrado', closed_at = now() WHERE id = $1`,
      [params.id]
    );
  });
  return NextResponse.json({ ok: true, applied, activated });
}
