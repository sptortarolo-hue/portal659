import { queryMany, queryOne } from "@/lib/db";

const TZ_AR = "America/Argentina/Buenos_Aires";

export { CASH_METHOD_LABELS as CLOSING_METHOD_LABELS } from "@/lib/cash-methods";

export type ClosingMethodTotals = { count: number; total: number };

export type CashClosingSummary = {
  since: string;
  ordersCount: number;
  grossTotal: number;
  discountsTotal: number;
  netTotal: number;
  byMethod: Record<string, ClosingMethodTotals>;
  cashTotal: number;
  avgTicket: number;
  /** Señas de apartados cobradas en el rango con saldo aún pendiente. Van
   * aparte para no duplicar: cuando se cobra el saldo, el total entra por
   * paid_at y la seña sale de acá. Visualización en Fase D (Caja para moda). */
  senasTotal: number;
  senasCount: number;
  senasByMethod: Record<string, ClosingMethodTotals>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Inicio del día civil actual en horario argentino (offset fijo -03:00). */
function startOfTodayAr(): string {
  const dayKey = new Date().toLocaleDateString("en-CA", { timeZone: TZ_AR });
  return new Date(`${dayKey}T00:00:00-03:00`).toISOString();
}

/**
 * Momento desde el que se computan los cobros: el último Z guardado del
 * comercio, o el arranque del día civil actual si todavía no hubo ninguno.
 */
export async function lastClosingSince(vendorId: string): Promise<string> {
  const last = await queryOne<{ closed_at: string }>(
    `SELECT closed_at FROM cash_closings WHERE vendor_id = $1 ORDER BY closed_at DESC LIMIT 1`,
    [vendorId]
  );
  if (last?.closed_at) return new Date(last.closed_at).toISOString();
  return startOfTodayAr();
}

/**
 * Cobros del rango (paid_at no nulo, no cancelados) agrupados por medio de
 * pago. Con descuento en efectivo, `orders.total` es neto y `cash_discount`
 * el desagregado: bruto = total + descuento, neto = total.
 */
export async function computeCashClosing(
  vendorId: string,
  since: string
): Promise<CashClosingSummary> {
  const rows = await queryMany<{
    payment_method: string | null;
    total: number;
    cash_discount: number | null;
  }>(
    `SELECT payment_method, total, cash_discount
     FROM orders
     WHERE vendor_id = $1 AND paid_at IS NOT NULL AND paid_at >= $2 AND status != 'cancelled'`,
    [vendorId, since]
  );

  const byMethod: Record<string, ClosingMethodTotals> = {};
  let gross = 0;
  let discounts = 0;
  let net = 0;

  for (const o of rows) {
    const total = Number(o.total) || 0;
    const disc = Number(o.cash_discount) || 0;
    const m = o.payment_method || "efectivo";
    if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
    byMethod[m].count++;
    byMethod[m].total += total;
    gross += total + disc;
    discounts += disc;
    net += total;
  }

  const rounded: Record<string, ClosingMethodTotals> = {};
  for (const [m, d] of Object.entries(byMethod)) {
    rounded[m] = { count: d.count, total: round2(d.total) };
  }

  // Señas de apartados cobradas en el rango con saldo aún pendiente: la
  // plata está en el cajón pero el pedido no tiene paid_at todavía.
  // Tolerante a migración sin aplicar (el cierre existente no se rompe).
  let senasTotal = 0;
  let senasCount = 0;
  const senasByMethod: Record<string, ClosingMethodTotals> = {};
  try {
    const srows = await queryMany<{
      payment_method: string | null;
      deposit_amount: number;
    }>(
      `SELECT payment_method, deposit_amount
       FROM orders
       WHERE vendor_id = $1 AND is_apartado = true AND deposit_status = 'paid'
         AND remainder_paid_at IS NULL AND status != 'cancelled'
         AND deposit_paid_at IS NOT NULL AND deposit_paid_at >= $2`,
      [vendorId, since]
    );
    for (const s of srows || []) {
      const amount = Number(s.deposit_amount) || 0;
      if (!(amount > 0)) continue;
      const m = s.payment_method || "efectivo";
      if (!senasByMethod[m]) senasByMethod[m] = { count: 0, total: 0 };
      senasByMethod[m].count++;
      senasByMethod[m].total += amount;
      senasCount++;
      senasTotal += amount;
    }
    for (const d of Object.values(senasByMethod)) d.total = round2(d.total);
  } catch {
    // Sin columnas de apartado: sin señas para sumar.
  }

  return {
    since,
    ordersCount: rows.length,
    grossTotal: round2(gross),
    discountsTotal: round2(discounts),
    netTotal: round2(net),
    byMethod: rounded,
    cashTotal: rounded["efectivo"]?.total ?? 0,
    avgTicket: rows.length > 0 ? round2(net / rows.length) : 0,
    senasTotal: round2(senasTotal),
    senasCount,
    senasByMethod,
  };
}
