import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import { computeCashClosing, lastClosingSince } from "@/lib/cash-closing";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El cierre de caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const since = await lastClosingSince(gate.vendor.id);
  const summary = await computeCashClosing(gate.vendor.id, since);
  return NextResponse.json({ summary });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El cierre de caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const since = await lastClosingSince(gate.vendor.id);
  const summary = await computeCashClosing(gate.vendor.id, since);

  const cashDeclared =
    body?.cashDeclared != null && Number(body.cashDeclared) >= 0 ? Number(body.cashDeclared) : null;
  const cashDifference =
    cashDeclared != null ? Math.round((cashDeclared - summary.cashTotal) * 100) / 100 : null;
  const notes =
    typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;
  // Sesión de prueba: no tiene perfil en la tabla (user.id es "preview:..."),
  // el cierre queda sin created_by en vez de romper el FK.
  const userId = gate.previewSession ? null : gate.user.id;

  const closing = await withTransaction(async (tx) => {
    return tx.queryOne<{ id: string; closed_at: string }>(
      `INSERT INTO cash_closings
        (vendor_id, closed_at, since, orders_count, gross_total, discounts_total, net_total, by_method, cash_declared, cash_difference, notes, created_by)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, closed_at`,
      [
        gate.vendor.id,
        since,
        summary.ordersCount,
        summary.grossTotal,
        summary.discountsTotal,
        summary.netTotal,
        JSON.stringify(summary.byMethod),
        cashDeclared,
        cashDifference,
        notes,
        userId,
      ]
    );
  });

  return NextResponse.json({
    ok: true,
    closing,
    summary: { ...summary, cashDeclared, cashDifference },
  });
}
