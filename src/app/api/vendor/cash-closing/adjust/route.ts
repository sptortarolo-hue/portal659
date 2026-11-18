import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import {
  applyClosingAdjustments,
  listClosingAdjustments,
  summarizeAdjustments,
  type CashAdjustmentKind,
} from "@/lib/cash-closing";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";
import { NextResponse } from "next/server";

const KINDS: CashAdjustmentKind[] = ["venta_faltante", "venta_duplicada", "otro"];

function migrationMissing() {
  return NextResponse.json(
    {
      error:
        "Falta aplicar la migración de ajustes post-cierre en la base de datos (migrate-cash-adjustments.sql)",
      code: "migration_missing",
    },
    { status: 503 }
  );
}

/**
 * Ajustes post-cierre: corrige un Z ya cerrado cuando una venta quedó sin
 * registrar, se registró dos veces o se cargó con el medio de pago equivocado.
 * No reescribe el cierre ni mueve dinero: deja el ajuste firmado con motivo,
 * autor y fecha, y el panel suma los importes al neto y al esperado.
 *
 * GET  ?closingId=  → ajustes (de un cierre o de todo el comercio)
 * POST { closingId, amount, kind, method, direction?, reason }
 *      amount es la magnitud (positiva). El signo lo define `kind`:
 *      venta_faltante → +, venta_duplicada → −, otro → `direction` o el signo
 *      del monto recibido.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request, { allowStaff: true });
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "La caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const closingId = new URL(request.url).searchParams.get("closingId") || "";
  if (closingId) {
    const closing = await queryOne<Record<string, unknown>>(
      `SELECT id FROM cash_closings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [closingId, gate.vendor.id]
    ).catch(() => null);
    if (!closing) {
      return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });
    }
  }
  const adjustments = await listClosingAdjustments(
    gate.vendor.id,
    closingId ? [closingId] : undefined
  );
  return NextResponse.json({ adjustments, totals: summarizeAdjustments(adjustments) });
}

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
  const closingId = typeof body?.closingId === "string" ? body.closingId.trim() : "";
  if (!closingId) {
    return NextResponse.json({ error: "Indicá el cierre a ajustar" }, { status: 400 });
  }

  const rawAmount = Number(body?.amount);
  if (!Number.isFinite(rawAmount) || Math.abs(rawAmount) >= 1e9) {
    return NextResponse.json({ error: "Indicá un monto válido" }, { status: 400 });
  }
  const magnitude = Math.round(Math.abs(rawAmount) * 100) / 100;
  if (!(magnitude > 0)) {
    return NextResponse.json({ error: "El monto tiene que ser mayor a 0" }, { status: 400 });
  }

  const kind: CashAdjustmentKind = KINDS.includes(body?.kind) ? body.kind : "otro";
  const methodRaw = typeof body?.method === "string" ? body.method.trim() : "efectivo";
  const method = methodRaw || "efectivo";
  if (!(method in CASH_METHOD_LABELS)) {
    return NextResponse.json({ error: "Medio de pago inválido" }, { status: 400 });
  }

  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 240) : "";
  if (reason.length < 3) {
    return NextResponse.json(
      { error: "Escribí el motivo del ajuste (qué pasó y por qué)" },
      { status: 400 }
    );
  }

  // Signo: la venta faltante suma; la duplicada resta. "Otro" acepta la
  // dirección elegida (o el signo del monto si no se manda dirección).
  let direction = 1;
  if (kind === "venta_faltante") direction = 1;
  else if (kind === "venta_duplicada") direction = -1;
  else if (body?.direction === "resta") direction = -1;
  else if (body?.direction === "suma") direction = 1;
  else direction = rawAmount < 0 ? -1 : 1;
  const amount = Math.round(magnitude * direction * 100) / 100;

  const closing = await queryOne<Record<string, any>>(
    `SELECT id, closed_at, gross_total, net_total, expected_cash, cash_declared,
            cash_difference, by_method
     FROM cash_closings
     WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [closingId, gate.vendor.id]
  ).catch(async () => {
    // Sin migración de turnos (expected_cash no existe): cierre legacy.
    return queryOne<Record<string, any>>(
      `SELECT id, closed_at, gross_total, net_total, cash_declared,
              cash_difference, by_method
       FROM cash_closings
       WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [closingId, gate.vendor.id]
    ).catch(() => null);
  });
  if (!closing) {
    return NextResponse.json({ error: "Cierre no encontrado" }, { status: 404 });
  }

  // Sesión de prueba: sin perfil en la tabla (user.id es "preview:..."), el
  // ajuste queda sin autor en vez de romper el FK.
  const userId = gate.previewSession ? null : gate.user.id;

  let adjustment;
  try {
    adjustment = await queryOne<{ id: string; created_at: string }>(
      `INSERT INTO cash_closing_adjustments
         (vendor_id, closing_id, amount, method, kind, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [gate.vendor.id, closingId, amount, method, kind, reason, userId]
    );
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const msg = e instanceof Error ? e.message : "";
    if (code === "42P01" || /relation .*cash_closing_adjustments.* does not exist/i.test(msg)) {
      return migrationMissing();
    }
    return NextResponse.json(
      { error: "No se pudo registrar el ajuste" },
      { status: 500 }
    );
  }
  if (!adjustment) {
    return NextResponse.json({ error: "No se pudo registrar el ajuste" }, { status: 500 });
  }

  const all = await listClosingAdjustments(gate.vendor.id, [closingId]);
  const totals = summarizeAdjustments(all);
  const adjusted = applyClosingAdjustments(closing, all);

  return NextResponse.json({
    ok: true,
    adjustment,
    totals,
    closing: {
      id: closing.id,
      adjustment_total: adjusted.adjustment_total,
      adjustment_cash: adjusted.adjustment_cash,
      adjusted_net_total: adjusted.adjusted_net_total,
      adjusted_expected_cash: adjusted.adjusted_expected_cash,
      adjusted_cash_difference: adjusted.adjusted_cash_difference,
    },
  });
}
