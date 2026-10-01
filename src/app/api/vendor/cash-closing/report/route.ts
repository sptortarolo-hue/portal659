import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

const MAX_RANGE_DAYS = 366;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(v: string | null, fallback: Date): Date {
  if (!v) return fallback;
  const d = new Date(v.length <= 10 ? `${v}T00:00:00-03:00` : v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Consolidado de cierres (estilo ZZ): agrega los Z del rango.
 * GET /api/vendor/cash-closing/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Sin params: últimos 30 días. Rango máximo: 366 días.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "Los reportes de caja forman parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const now = new Date();
  const defFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let from = parseDate(url.searchParams.get("from"), defFrom);
  let to = parseDate(url.searchParams.get("to"), now);
  if (from > to) [from, to] = [to, from];
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    from = new Date(to.getTime() - MAX_RANGE_DAYS * 24 * 60 * 60 * 1000);
  }

  let rows: Record<string, any>[];
  try {
    rows = await queryMany<Record<string, any>>(
      `SELECT c.id, c.closed_at, c.since, c.orders_count, c.gross_total,
              c.discounts_total, c.net_total, c.by_method, c.cash_declared,
              c.cash_difference, c.notes, c.opening_amount, c.movements,
              c.expected_cash, s.opened_at, p.full_name AS opened_by_name,
              cb.full_name AS closed_by_name
       FROM cash_closings c
       LEFT JOIN cash_shifts s ON s.id = c.shift_id
       LEFT JOIN profiles p ON p.id = s.opened_by
       LEFT JOIN profiles cb ON cb.id = c.created_by
       WHERE c.vendor_id = $1 AND c.closed_at >= $2 AND c.closed_at <= $3
       ORDER BY c.closed_at ASC`,
      [gate.vendor.id, from.toISOString(), to.toISOString()]
    );
  } catch {
    // Migración de turnos sin aplicar: consolidado legacy sin esos datos.
    rows = await queryMany<Record<string, any>>(
      `SELECT id, closed_at, since, orders_count, gross_total,
              discounts_total, net_total, by_method, cash_declared,
              cash_difference, notes
       FROM cash_closings
       WHERE vendor_id = $1 AND closed_at >= $2 AND closed_at <= $3
       ORDER BY closed_at ASC`,
      [gate.vendor.id, from.toISOString(), to.toISOString()]
    );
  }
  rows = rows || [];

  const byMethod: Record<string, { count: number; total: number }> = {};
  let gross = 0;
  let discounts = 0;
  let net = 0;
  let orders = 0;
  let expected = 0;
  let declared = 0;
  let sobra = 0;
  let falta = 0;
  let opening = 0;
  let ingresos = 0;
  let retiros = 0;
  for (const r of rows) {
    for (const [m, d] of Object.entries((r.by_method || {}) as Record<string, any>)) {
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count += Number(d?.count) || 0;
      byMethod[m].total += Number(d?.total) || 0;
    }
    gross += Number(r.gross_total) || 0;
    discounts += Number(r.discounts_total) || 0;
    net += Number(r.net_total) || 0;
    orders += Number(r.orders_count) || 0;
    if (r.expected_cash != null) expected += Number(r.expected_cash) || 0;
    if (r.cash_declared != null) declared += Number(r.cash_declared) || 0;
    const diff = r.cash_difference != null ? Number(r.cash_difference) : null;
    if (diff != null) {
      if (diff > 0) sobra += diff;
      else falta += Math.abs(diff);
    }
    if (r.opening_amount != null) opening += Number(r.opening_amount) || 0;
    ingresos += Number(r.movements?.ingresos) || 0;
    retiros += Number(r.movements?.retiros) || 0;
  }
  for (const d of Object.values(byMethod)) d.total = round2(d.total);

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    count: rows.length,
    orders,
    byMethod,
    gross: round2(gross),
    discounts: round2(discounts),
    net: round2(net),
    expected: round2(expected),
    declared: round2(declared),
    sobra: round2(sobra),
    falta: round2(falta),
    opening: round2(opening),
    ingresos: round2(ingresos),
    retiros: round2(retiros),
    closings: rows,
  });
}
