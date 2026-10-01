import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { computeShiftSummary, getOpenShift } from "@/lib/cash-closing";
import { NextResponse } from "next/server";

/**
 * Movimiento manual de efectivo dentro del turno abierto (no es una venta):
 * ingreso (fondo extra, cambio) o retiro (proveedor, retiro parcial).
 * El retiro se bloquea si supera el disponible (el cajón no queda negativo).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "La caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const shift = await getOpenShift(gate.vendor.id);
  if (!shift) {
    return NextResponse.json(
      { error: "Abrí la caja antes de registrar movimientos", code: "no_shift" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const kind = body?.kind === "retiro" ? "retiro" : body?.kind === "ingreso" ? "ingreso" : null;
  const amount = Number(body?.amount);
  const reason =
    typeof body?.reason === "string" ? body.reason.trim().slice(0, 140) : "";
  if (!kind) {
    return NextResponse.json({ error: "Tipo inválido (ingreso o retiro)" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e9) {
    return NextResponse.json({ error: "Indicá un monto mayor a 0" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "Indicá el motivo del movimiento" }, { status: 400 });
  }

  const summary = await computeShiftSummary(gate.vendor.id, shift);
  if (kind === "retiro" && amount > summary.expectedCash) {
    return NextResponse.json(
      {
        error: `No hay suficiente: disponible ${summary.expectedCash.toLocaleString("es-AR")}`,
        code: "insufficient_cash",
        disponible: summary.expectedCash,
      },
      { status: 400 }
    );
  }

  const userId = gate.previewSession ? null : gate.user.id;
  let movement;
  try {
    movement = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO cash_movements (vendor_id, shift_id, kind, amount, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [gate.vendor.id, shift.id, kind, Math.round(amount * 100) / 100, reason, userId]
    );
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración de turnos de caja en la base de datos", code: "migration_missing" },
      { status: 503 }
    );
  }
  if (!movement) {
    return NextResponse.json({ error: "No se pudo registrar el movimiento" }, { status: 500 });
  }
  const after = await computeShiftSummary(gate.vendor.id, shift);
  return NextResponse.json({ ok: true, movement, disponible: after.expectedCash });
}
