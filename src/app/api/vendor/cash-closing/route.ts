import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import {
  computeCashClosing,
  computeShiftSummary,
  getOpenShift,
  lastClosingSince,
} from "@/lib/cash-closing";
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
  // Turno abierto (si hay): movimientos + efectivo disponible ahora.
  // Aditivo: sin turno (o sin migración aplicada) va null/[] y la caja
  // funciona en modo legacy como antes.
  const shift = await getOpenShift(gate.vendor.id);
  // Switch "exigir caja abierta para cobrar" (tolerante a migración sin
  // aplicar: la columna puede no existir y resuelve false).
  const requireOpenShift =
    (gate.vendor as Record<string, unknown>)?.require_open_shift === true;
  if (!shift)
    return NextResponse.json({ summary, shift: null, movements: [], disponible: null, requireOpenShift });
  const shiftSummary = await computeShiftSummary(gate.vendor.id, shift);
  return NextResponse.json({
    summary,
    shift,
    movements: shiftSummary.movements,
    disponible: shiftSummary.expectedCash,
    requireOpenShift,
  });
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
  const cashDeclaredRaw = body?.cashDeclared;
  // El conteo físico es obligatorio para cerrar (el cierre congela el
  // período y no se puede rectificar después: el pre-cierre existe para eso).
  if (cashDeclaredRaw == null || !(Number(cashDeclaredRaw) >= 0)) {
    return NextResponse.json(
      { error: "Contá el efectivo del cajón antes de cerrar la caja", code: "count_required" },
      { status: 400 }
    );
  }
  const since = await lastClosingSince(gate.vendor.id);
  const summary = await computeCashClosing(gate.vendor.id, since);
  // Si hay turno abierto, el cierre lo liquida: el esperado incluye fondo
  // inicial + ventas en efectivo + movimientos manuales.
  const shift = await getOpenShift(gate.vendor.id);
  const shiftSummary = shift ? await computeShiftSummary(gate.vendor.id, shift) : null;
  const expectedCash = shiftSummary ? shiftSummary.expectedCash : null;

  const cashDeclared = Math.round(Number(cashDeclaredRaw) * 100) / 100;
  const cashDiffBase = expectedCash ?? summary.cashTotal;
  const cashDifference = Math.round((cashDeclared - cashDiffBase) * 100) / 100;
  const notes =
    typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null;
  // Sesión de prueba: no tiene perfil en la tabla (user.id es "preview:..."),
  // el cierre queda sin created_by en vez de romper el FK.
  const userId = gate.previewSession ? null : gate.user.id;

  const closing = await withTransaction(async (tx) => {
    let row;
    try {
      row = await tx.queryOne<{ id: string; closed_at: string }>(
        `INSERT INTO cash_closings
          (vendor_id, closed_at, since, orders_count, gross_total, discounts_total, net_total, by_method, cash_declared, cash_difference, notes, created_by,
           shift_id, opening_amount, movements, expected_cash)
         VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
          shift?.id ?? null,
          shift ? shift.opening_amount : null,
          JSON.stringify({
            ingresos: shiftSummary?.ingresosTotal ?? 0,
            retiros: shiftSummary?.retirosTotal ?? 0,
          }),
          expectedCash,
        ]
      );
    } catch {
      // Migración de turnos sin aplicar: cierre legacy sin columnas nuevas.
      row = await tx.queryOne<{ id: string; closed_at: string }>(
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
    }
    if (shift && row) {
      await tx.queryVoid(
        `UPDATE cash_shifts SET status = 'closed', closed_at = now(), closing_id = $1 WHERE id = $2`,
        [row.id, shift.id]
      );
    }
    return row;
  });

  return NextResponse.json({
    ok: true,
    closing,
    summary: { ...summary, cashDeclared, cashDifference, expectedCash },
  });
}
