import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
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

  const closings = await queryMany<Record<string, any>>(
    `SELECT id, closed_at, since, orders_count, gross_total, discounts_total, net_total,
            by_method, cash_declared, cash_difference, notes
     FROM cash_closings
     WHERE vendor_id = $1
     ORDER BY closed_at DESC
     LIMIT 30`,
    [gate.vendor.id]
  );

  // Enriquecimiento con el turno (tolerante a migración sin aplicar o a
  // cierres legacy sin turno: esos quedan sin datos de apertura).
  try {
    const shifts = await queryMany<Record<string, any>>(
      `SELECT c.id AS closing_id, c.opening_amount, c.movements, c.expected_cash,
              s.opened_at, p.full_name AS opened_by_name, cb.full_name AS closed_by_name
       FROM cash_closings c
       LEFT JOIN cash_shifts s ON s.id = c.shift_id
       LEFT JOIN profiles p ON p.id = s.opened_by
       LEFT JOIN profiles cb ON cb.id = c.created_by
       WHERE c.vendor_id = $1`,
      [gate.vendor.id]
    );
    const byClosing = new Map((shifts || []).map((s) => [s.closing_id, s]));
    for (const c of closings || []) {
      const s = byClosing.get(c.id);
      if (!s) continue;
      if (s.opened_at != null) {
        c.opened_at = s.opened_at;
        c.opening_amount = s.opening_amount;
        c.movements = s.movements || { ingresos: 0, retiros: 0 };
        c.expected_cash = s.expected_cash;
        c.opened_by_name = s.opened_by_name;
      }
      c.closed_by_name = s.closed_by_name || null;
    }
  } catch {
    // Sin columnas/tablas de turnos: historial legacy sin enriquecer.
  }

  return NextResponse.json({ closings: closings || [] });
}
