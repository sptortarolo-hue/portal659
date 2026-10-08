import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { getOpenShift } from "@/lib/cash-closing";
import { NextResponse } from "next/server";

/**
 * Apertura de caja: fondo inicial en efectivo + responsable + momento.
 * Un solo turno abierto por comercio (409 si ya hay uno).
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "La caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const opening = Number(body?.opening_amount);
  if (!Number.isFinite(opening) || opening < 0 || opening >= 1e9) {
    return NextResponse.json(
      { error: "Indicá el monto inicial en efectivo (0 o más)" },
      { status: 400 }
    );
  }

  const existing = await getOpenShift(gate.vendor.id);
  if (existing) {
    return NextResponse.json(
      { error: "Ya hay una caja abierta: cerrala antes de abrir otra", code: "shift_open" },
      { status: 409 }
    );
  }

  const userId = gate.previewSession ? null : gate.user.id;
  let shift;
  try {
    shift = await queryOne<{ id: string; opened_at: string }>(
      `INSERT INTO cash_shifts (vendor_id, opening_amount, opened_by)
       VALUES ($1, $2, $3) RETURNING id, opened_at`,
      [gate.vendor.id, Math.round(opening * 100) / 100, userId]
    );
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración de turnos de caja en la base de datos", code: "migration_missing" },
      { status: 503 }
    );
  }
  if (!shift) {
    return NextResponse.json({ error: "No se pudo abrir la caja" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, shift });
}
