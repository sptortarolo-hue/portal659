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
  // Eslabón con el turno anterior (para el pase Juan → María y la
  // verificación al abrir). Tolerante a migración de pase sin aplicar.
  let previousShiftId: string | null = null;
  try {
    const prev = await queryOne<{ id: string }>(
      `SELECT id FROM cash_shifts
       WHERE vendor_id = $1 AND status = 'closed'
       ORDER BY closed_at DESC NULLS LAST, opened_at DESC LIMIT 1`,
      [gate.vendor.id]
    );
    previousShiftId = prev?.id || null;
  } catch {
    previousShiftId = null;
  }
  let shift;
  try {
    try {
      shift = await queryOne<{ id: string; opened_at: string }>(
        `INSERT INTO cash_shifts (vendor_id, opening_amount, opened_by, previous_shift_id)
         VALUES ($1, $2, $3, $4) RETURNING id, opened_at`,
        [gate.vendor.id, Math.round(opening * 100) / 100, userId, previousShiftId]
      );
    } catch (e: any) {
      // Migración de pase sin aplicar: apertura sin eslabón.
      if (e?.code !== "42703" && !String(e?.message || "").includes("previous_shift_id")) throw e;
      shift = await queryOne<{ id: string; opened_at: string }>(
        `INSERT INTO cash_shifts (vendor_id, opening_amount, opened_by)
         VALUES ($1, $2, $3) RETURNING id, opened_at`,
        [gate.vendor.id, Math.round(opening * 100) / 100, userId]
      );
    }
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
