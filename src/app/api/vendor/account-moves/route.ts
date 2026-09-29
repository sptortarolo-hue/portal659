import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import {
  fiadoTableReady,
  getFiadoBalance,
  imputeFiadoPayment,
  validateFiadoPhone,
} from "@/lib/fiados";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "El fiado forma parte del plan Gestión integral";

/**
 * GET /api/vendor/account-moves?phone= → { balance, charges, payments, moves, pendingOrders }
 * POST /api/vendor/account-moves { phone, amount, note? } → registra un pago
 *   e imputa a fiados pendientes (los cubiertos entran al Z).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("crm")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone") || "";
  const e164 = validateFiadoPhone(phone, (gate.vendor as any)?.whatsapp || null);
  if (!e164) return NextResponse.json({ error: "Teléfono inválido" }, { status: 400 });
  const balance = await getFiadoBalance(queryMany, gate.vendor.id, e164);
  let moves: unknown[] = [];
  try {
    moves =
      (await queryMany(
        `SELECT kind, amount, note, ref_order, created_at FROM account_moves
         WHERE vendor_id = $1 AND customer_phone = $2 ORDER BY created_at DESC LIMIT 100`,
        [gate.vendor.id, e164]
      )) || [];
  } catch {
    moves = [];
  }
  return NextResponse.json({ ...balance, moves });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("crm")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const e164 = validateFiadoPhone(String(body?.phone || ""), (gate.vendor as any)?.whatsapp || null);
  if (!e164) {
    return NextResponse.json({ error: "Teléfono inválido" }, { status: 400 });
  }
  const amount = Math.round(Number(body?.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }
  const ready = await fiadoTableReady(queryOne);
  if (!ready) {
    return NextResponse.json({ error: "Falta aplicar la migración de fiado" }, { status: 503 });
  }
  const now = new Date().toISOString();
  const note =
    typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  const out = await withTransaction(async (tx) => {
    await tx.queryVoid(
      `INSERT INTO account_moves (vendor_id, customer_phone, kind, amount, note, created_by)
       VALUES ($1, $2, 'payment', $3, $4, $5)`,
      [gate.vendor.id, e164, amount, note, gate.user.id]
    );
    const { coveredIds, remaining } = await imputeFiadoPayment(tx, gate.vendor.id, e164, amount, now);
    return { coveredIds, remaining };
  });
  const balance = await getFiadoBalance(queryMany, gate.vendor.id, e164);
  return NextResponse.json({ ok: true, ...out, balance: balance.balance });
}
