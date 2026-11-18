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
  /** Transferencias desglosadas por cuenta (multi-cuenta). Vacío si no
   *  hay cuentas o la migración no se aplicó. */
  transferByAccount: import("@/lib/bank-accounts").TransferByAccountRow[];
  cashTotal: number;
  avgTicket: number;
  /** Señas de apartados cobradas en el rango con saldo aún pendiente. Van
   * aparte para no duplicar: cuando se cobra el saldo, el total entra por
   * paid_at y la seña sale de acá. Visualización en Fase D (Caja para moda). */
  senasTotal: number;
  senasCount: number;
  senasByMethod: Record<string, ClosingMethodTotals>;
  /** Señas de turnos/consultas cobradas en el período (MP/Stripe). Se
   * suman al total del período en el mismo momento en que se acreditaron,
   * para que el cierre refleje todos los ingresos. */
  depositsTotal: number;
  depositsCount: number;
  depositsByMethod: Record<string, ClosingMethodTotals>;
  /** Egresos del libro de Gastos (manual + compras) creados en el período.
   *  Los retiros de caja categorizados (source='caja') ya están en los
   *  movimientos y se excluyen aquí para no duplicar. */
  egresosGastos: number;
  egresosGastosCount: number;
  /** Parte de esos gastos pagada en efectivo (baja el efectivo esperado). */
  gastosEfectivo: number;
  /** Ingresos manuales (packs/giftcards) creados en el período. */
  manualIncomeTotal: number;
  manualIncomeCount: number;
  manualIncomeByMethod: Record<string, ClosingMethodTotals>;
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
 * Momento desde el que se computan los cobros: si hay turno abierto, la
 * apertura; si no, el último Z guardado (o el arranque del día civil).
 * Así el resumen "en vivo" de la Caja se ancla al turno cuando lo hay.
 */
export async function lastClosingSince(vendorId: string): Promise<string> {
  const shift = await getOpenShift(vendorId);
  if (shift?.opened_at) return new Date(shift.opened_at).toISOString();
  const last = await queryOne<{ closed_at: string }>(
    `SELECT closed_at FROM cash_closings WHERE vendor_id = $1 ORDER BY closed_at DESC LIMIT 1`,
    [vendorId]
  );
  if (last?.closed_at) return new Date(last.closed_at).toISOString();
  return startOfTodayAr();
}

/** Turno de caja abierto (uno por comercio como máximo). */
export type CashShift = {
  id: string;
  opened_at: string;
  opening_amount: number;
  opened_by: string | null;
  opened_by_name: string | null;
  status: "open" | "closed";
};

/** Movimiento manual de efectivo dentro del turno. */
export type CashMovement = {
  id: string;
  kind: "ingreso" | "retiro";
  amount: number;
  reason: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

/**
 * Turno abierto del comercio (con nombre de quien lo abrió).
 * Tolerante a migración sin aplicar: devuelve null y la caja sigue en
 * modo legacy (período desde último Z).
 */
export async function getOpenShift(vendorId: string): Promise<CashShift | null> {
  try {
    const row = await queryOne<{
      id: string;
      opened_at: string;
      opening_amount: number;
      opened_by: string | null;
      opened_by_name: string | null;
      status: string;
    }>(
      `SELECT s.id, s.opened_at, s.opening_amount, s.opened_by, s.status,
              p.full_name AS opened_by_name
       FROM cash_shifts s LEFT JOIN profiles p ON p.id = s.opened_by
       WHERE s.vendor_id = $1 AND s.status = 'open' LIMIT 1`,
      [vendorId]
    );
    if (!row) return null;
    return {
      id: row.id,
      opened_at: new Date(row.opened_at).toISOString(),
      opening_amount: Number(row.opening_amount) || 0,
      opened_by: row.opened_by,
      opened_by_name: row.opened_by_name,
      status: "open",
    };
  } catch {
    return null;
  }
}

/** Movimientos del turno, ordenados por creación. */
export async function listShiftMovements(shiftId: string): Promise<CashMovement[]> {
  try {
    const rows = await queryMany<{
      id: string;
      kind: string;
      amount: number;
      reason: string;
      created_by: string | null;
      created_by_name: string | null;
      created_at: string;
    }>(
      `SELECT m.id, m.kind, m.amount, m.reason, m.created_by, m.created_at,
              p.full_name AS created_by_name
       FROM cash_movements m LEFT JOIN profiles p ON p.id = m.created_by
       WHERE m.shift_id = $1 ORDER BY m.created_at ASC`,
      [shiftId]
    );
    return (rows || []).map((r) => ({
      id: r.id,
      kind: r.kind === "retiro" ? "retiro" : "ingreso",
      amount: Number(r.amount) || 0,
      reason: r.reason || "",
      created_by: r.created_by,
      created_by_name: r.created_by_name,
      created_at: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}

export type ShiftSummary = {
  shift: CashShift;
  movements: CashMovement[];
  ingresosTotal: number;
  retirosTotal: number;
  /** Egresos del libro de Gastos (manual + compras) creados en el período.
   *  Los retiros de caja categorizados (source='caja') ya están en
   *  retirosTotal y no se duplican. */
  egresosGastos: number;
  egresosGastosCount: number;
  gastosEfectivo: number;
  /**
   * Efectivo esperado/disponible ahora (estilo Lightspeed):
   * apertura + ventas en efectivo del turno (+ señas en efectivo con
   * saldo pendiente: plata física en el cajón) + ingresos − retiros.
   */
  expectedCash: number;
};

/** Resumen del turno: ventas del período + movimientos + esperado. */
export async function computeShiftSummary(
  vendorId: string,
  shift: CashShift
): Promise<ShiftSummary> {
  const sales = await computeCashClosing(vendorId, shift.opened_at);
  const movements = await listShiftMovements(shift.id);
  let ingresosTotal = 0;
  let retirosTotal = 0;
  for (const m of movements) {
    if (m.kind === "retiro") retirosTotal += m.amount;
    else ingresosTotal += m.amount;
  }
  const senasCash = sales.senasByMethod?.["efectivo"]?.total ?? 0;
  const gastosEfectivo = sales.gastosEfectivo ?? 0;
  const expectedCash = round2(
    shift.opening_amount + sales.cashTotal + senasCash + ingresosTotal - retirosTotal - gastosEfectivo
  );
  return {
    shift,
    movements,
    ingresosTotal: round2(ingresosTotal),
    retirosTotal: round2(retirosTotal),
    egresosGastos: sales.egresosGastos ?? 0,
    egresosGastosCount: sales.egresosGastosCount ?? 0,
    gastosEfectivo: round2(gastosEfectivo),
    expectedCash,
  };
}

/**
 * Ajuste post-cierre (migrate-cash-adjustments).
 *
 * El Z congela el período y no se reescribe: si después aparece una venta sin
 * registrar, una venta duplicada o un medio de pago equivocado, se carga un
 * ajuste firmado. `amount` positivo sube el neto (y el efectivo esperado si el
 * medio es efectivo); negativo lo baja. Nunca mueve dinero ni reabre el turno.
 */
export type CashAdjustmentKind = "venta_faltante" | "venta_duplicada" | "otro";

export type CashAdjustment = {
  id: string;
  closing_id: string;
  amount: number;
  method: string;
  kind: CashAdjustmentKind;
  reason: string;
  /** Venta vinculada: la creada (faltante) o la anulada (duplicada). */
  order_id?: string | null;
  /** Número de pedido (pickup_number) para mostrarlo en el panel/A4/ticket. */
  order_number?: number | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type AdjustmentTotals = {
  count: number;
  /** Suma firmada de todos los ajustes (corrige el neto del cierre). */
  net: number;
  /** Parte en efectivo (corrige el esperado y la diferencia del arqueo). */
  cash: number;
  byMethod: Record<string, ClosingMethodTotals>;
};

/**
 * Ajustes de un comercio (o de un conjunto de cierres), con autor resuelto.
 * Tolerante a migración sin aplicar: sin tabla devuelve [].
 */
export async function listClosingAdjustments(
  vendorId: string,
  closingIds?: string[]
): Promise<CashAdjustment[]> {
  if (closingIds && closingIds.length === 0) return [];
  try {
    // order_id es de migrate-cash-adjustments-orders.sql: sin esa columna el
    // ajuste sigue siendo de solo números (tolerante a migración pendiente).
    const hasOrderCol = await hasColumn("cash_closing_adjustments", "order_id");
    const params: unknown[] = [vendorId];
    let scope = "";
    if (closingIds && closingIds.length > 0) {
      params.push(closingIds);
      scope = "AND a.closing_id = ANY($2)";
    }
    const rows = await queryMany<{
      id: string;
      closing_id: string;
      amount: number | string;
      method: string | null;
      kind: string | null;
      reason: string | null;
      order_id?: string | null;
      order_number?: number | null;
      created_by: string | null;
      created_by_name: string | null;
      created_at: string;
    }>(
      `SELECT a.id, a.closing_id, a.amount, a.method, a.kind, a.reason,
              a.created_by, a.created_at, p.full_name AS created_by_name
              ${hasOrderCol ? ", a.order_id, o.pickup_number AS order_number" : ""}
       FROM cash_closing_adjustments a
       LEFT JOIN profiles p ON p.id = a.created_by
       ${hasOrderCol ? "LEFT JOIN orders o ON o.id = a.order_id" : ""}
       WHERE a.vendor_id = $1 ${scope}
       ORDER BY a.created_at ASC`,
      params
    );
    return (rows || []).map((r) => ({
      id: r.id,
      closing_id: r.closing_id,
      amount: round2(Number(r.amount) || 0),
      method: r.method || "efectivo",
      kind:
        r.kind === "venta_faltante" || r.kind === "venta_duplicada" ? r.kind : "otro",
      reason: r.reason || "",
      order_id: r.order_id ?? null,
      order_number: r.order_number != null ? Number(r.order_number) : null,
      created_by: r.created_by,
      created_by_name: r.created_by_name,
      created_at: new Date(r.created_at).toISOString(),
    }));
  } catch {
    return [];
  }
}

/** Totales firmados de una lista de ajustes (neto, efectivo y por medio). */
export function summarizeAdjustments(list: CashAdjustment[]): AdjustmentTotals {
  const byMethod: Record<string, ClosingMethodTotals> = {};
  let net = 0;
  let cash = 0;
  for (const a of list) {
    const amount = Number(a.amount) || 0;
    if (amount === 0) continue;
    const m = a.method || "efectivo";
    if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
    byMethod[m].count++;
    byMethod[m].total += amount;
    net += amount;
    if (m === "efectivo") cash += amount;
  }
  for (const d of Object.values(byMethod)) d.total = round2(d.total);
  return { count: list.length, net: round2(net), cash: round2(cash), byMethod };
}

function parseByMethod(raw: unknown): Record<string, ClosingMethodTotals> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return (raw as Record<string, ClosingMethodTotals>) || {};
}

/**
 * Cierre + ajustes post-cierre: agrega los campos derivados que consumen el
 * panel, el A4 y el ticket. Nunca toca lo congelado (`net_total`,
 * `cash_declared`, `cash_difference`): el "antes" queda intacto.
 *
 * Base del esperado: `expected_cash` del turno; en cierres legacy (sin turno)
 * el efectivo del cierre (`by_method.efectivo`).
 */
export function applyClosingAdjustments<
  T extends {
    gross_total?: unknown;
    net_total?: unknown;
    expected_cash?: unknown;
    cash_declared?: unknown;
    by_method?: unknown;
  }
>(closing: T, adjustments: CashAdjustment[]) {
  const byMethod = parseByMethod(closing.by_method);
  const cashFrozen = Number(byMethod["efectivo"]?.total) || 0;
  const totals = summarizeAdjustments(adjustments);
  const expectedBase =
    closing.expected_cash != null ? Number(closing.expected_cash) || 0 : cashFrozen;
  const declared = closing.cash_declared != null ? Number(closing.cash_declared) || 0 : null;
  const adjustedExpected = round2(expectedBase + totals.cash);
  return {
    ...closing,
    adjustments,
    adjustment_count: totals.count,
    adjustment_total: totals.net,
    adjustment_cash: totals.cash,
    adjusted_net_total: round2((Number(closing.net_total) || 0) + totals.net),
    adjusted_gross_total: round2((Number(closing.gross_total) || 0) + totals.net),
    adjusted_expected_cash: adjustedExpected,
    adjusted_cash_difference:
      declared == null ? null : round2(declared - adjustedExpected),
  };
}

/**
 * Cobros del rango (paid_at no nulo, no cancelados) agrupados por medio de
 * pago. Con descuento en efectivo, `orders.total` es neto y `cash_discount`
 * el desagregado: bruto = total + descuento, neto = total.
 */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2) AS exists`,
    [table, column]
  ).catch(() => null);
  return row?.exists === true;
}

/** Egresos del libro de Gastos (manual + compras) creados en el período.
 *  Tolerante a migración sin aplicar: si la tabla no existe devuelve ceros. */
async function fetchPeriodGastos(
  vendorId: string,
  since: string
): Promise<{ total: number; count: number; efectivo: number }> {
  try {
    const rows = await queryMany<{ amount: number; payment_method: string | null }>(
      `SELECT amount, payment_method
       FROM expenses
       WHERE vendor_id = $1 AND created_at >= $2
         AND source IN ('manual', 'compra')`,
      [vendorId, since]
    );
    let total = 0;
    let efectivo = 0;
    let count = 0;
    for (const r of rows || []) {
      const a = Number(r.amount) || 0;
      if (!(a > 0)) continue;
      total += a;
      count++;
      if ((r.payment_method || "") === "efectivo") efectivo += a;
    }
    return { total: round2(total), count, efectivo: round2(efectivo) };
  } catch {
    return { total: 0, count: 0, efectivo: 0 };
  }
}

/** Ingresos manuales (packs de sesiones y giftcards) creados en el
 *  período, agrupados por medio de pago. Tolerante a migración sin aplicar. */
async function fetchPeriodManualIncome(
  vendorId: string,
  since: string
): Promise<{ total: number; count: number; byMethod: Record<string, ClosingMethodTotals> }> {
  const byMethod: Record<string, ClosingMethodTotals> = {};
  let total = 0;
  let count = 0;
  try {
    const rows = await queryMany<{ amount: number; payment_method: string | null }>(
      `SELECT amount, payment_method
       FROM manual_income
       WHERE vendor_id = $1 AND created_at >= $2`,
      [vendorId, since]
    );
    for (const r of rows || []) {
      const a = Number(r.amount) || 0;
      if (!(a > 0)) continue;
      const m = r.payment_method || "efectivo";
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count++;
      byMethod[m].total += a;
      count++;
      total += a;
    }
    for (const d of Object.values(byMethod)) d.total = round2(d.total);
  } catch {
    // tabla inexistente: sin ingresos manuales
  }
  return { total: round2(total), count, byMethod };
}

/**
 * ¿Existe la tabla del desglose de pagos? Tolerante a migración sin aplicar.
 */
async function hasPaymentsTable(): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT to_regclass('public.order_payments') IS NOT NULL AS ok`
  ).catch(() => null);
  return row?.ok === true;
}

/**
 * Filtro SQL para que las ventas nacidas de un ajuste post-cierre no vuelvan a
 * contar en ningún Z. El ajuste ya representa ese dinero en el cierre
 * congelado; si además entrara la venta, el próximo cierre la contaría dos
 * veces. Devuelve "" si la tabla o la columna todavía no existen (migración
 * sin aplicar: comportamiento anterior intacto).
 */
async function adjustmentSalesFilter(alias = "o"): Promise<string> {
  try {
    const t = await queryOne<{ ok: boolean }>(
      `SELECT to_regclass('public.cash_closing_adjustments') IS NOT NULL AS ok`
    );
    if (!t?.ok) return "";
    if (!(await hasColumn("cash_closing_adjustments", "order_id"))) return "";
    return `AND NOT EXISTS (SELECT 1 FROM cash_closing_adjustments aca WHERE aca.order_id = ${alias}.id)`;
  } catch {
    return "";
  }
}

/**
 * Desglose de cobros del período agrupado por medio (migrate-order-payments).
 * Dos bloques:
 *  - `kind='cobro'`: la venta/pago de un pedido, anclado al `paid_at`.
 *  - `kind='parcial'`: plata que entró por un cobro parcial de mesa, anclado
 *    a su propia fecha (la mesa puede cerrar mucho después).
 * Devuelve {} si la tabla no existe (la Caja cae al medio único de siempre).
 */
async function fetchPaymentsByMethod(
  vendorId: string,
  since: string
): Promise<Record<string, { count: number; total: number }>> {
  const byMethod: Record<string, { count: number; total: number }> = {};
  try {
    const notAdjustment = await adjustmentSalesFilter("o");
    const cobro = await queryMany<{ method: string; total: number | string; cnt: number | string }>(
      `SELECT p.method, SUM(p.amount) AS total, COUNT(*)::int AS cnt
       FROM order_payments p
       JOIN orders o ON o.id = p.order_id
       WHERE p.vendor_id = $1 AND p.kind = 'cobro'
         AND o.paid_at IS NOT NULL AND o.paid_at >= $2 AND o.status != 'cancelled'
         ${notAdjustment}
       GROUP BY p.method`,
      [vendorId, since]
    );
    for (const r of cobro || []) {
      byMethod[r.method] = {
        count: Number(r.cnt) || 0,
        total: Math.round((Number(r.total) || 0) * 100) / 100,
      };
    }
    const parcial = await queryMany<{ method: string; total: number | string; cnt: number | string }>(
      `SELECT method, SUM(amount) AS total, COUNT(*)::int AS cnt
       FROM order_payments
       WHERE vendor_id = $1 AND kind = 'parcial' AND created_at >= $2
       GROUP BY method`,
      [vendorId, since]
    );
    for (const r of parcial || []) {
      if (!byMethod[r.method]) byMethod[r.method] = { count: 0, total: 0 };
      byMethod[r.method].count += Number(r.cnt) || 0;
      byMethod[r.method].total =
        Math.round((byMethod[r.method].total + (Number(r.total) || 0)) * 100) / 100;
    }
  } catch {
    return {};
  }
  return byMethod;
}

async function fetchTransferByAccount(
  vendorId: string,
  since: string
): Promise<import("@/lib/bank-accounts").TransferByAccountRow[]> {
  const map = new Map<string, { label: string; count: number; total: number }>();
  const hasBankCol = await (async () => {
    try {
      const r = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_payments' AND column_name = 'bank_account_id') AS exists`
      );
      return r?.exists === true;
    } catch {
      return false;
    }
  })();
  if (!hasBankCol) return [];

  const notAdjustment = await adjustmentSalesFilter("o");

  const hasOrdersBankCol = await (async () => {
    try {
      const r = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'bank_account_id') AS exists`
      );
      return r?.exists === true;
    } catch {
      return false;
    }
  })();
  const hasBookingsBankCol = await (async () => {
    try {
      const r = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'bank_account_id') AS exists`
      );
      return r?.exists === true;
    } catch {
      return false;
    }
  })();

  try {
    const cobro = await queryMany<{ bank_account_id: string; label: string | null; total: number | string; cnt: number | string }>(
      `SELECT p.bank_account_id, a.label, SUM(p.amount) AS total, COUNT(*)::int AS cnt
       FROM order_payments p
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN vendor_bank_accounts a ON a.id = p.bank_account_id
       WHERE p.vendor_id = $1 AND p.method = 'transferencia' AND p.kind = 'cobro'
         AND p.bank_account_id IS NOT NULL
         AND o.paid_at IS NOT NULL AND o.paid_at >= $2 AND o.status != 'cancelled'
         ${notAdjustment}
       GROUP BY p.bank_account_id, a.label`,
      [vendorId, since]
    );
    for (const r of cobro || []) {
      const cur = map.get(String(r.bank_account_id)) || { label: r.label || "Cuenta", count: 0, total: 0 };
      cur.count += Number(r.cnt) || 0;
      cur.total += Number(r.total) || 0;
      if (r.label) cur.label = r.label;
      map.set(String(r.bank_account_id), cur);
    }
    const parcial = await queryMany<{ bank_account_id: string; label: string | null; total: number | string; cnt: number | string }>(
      `SELECT p.bank_account_id, a.label, SUM(p.amount) AS total, COUNT(*)::int AS cnt
       FROM order_payments p
       LEFT JOIN vendor_bank_accounts a ON a.id = p.bank_account_id
       WHERE p.vendor_id = $1 AND p.method = 'transferencia' AND p.kind = 'parcial'
         AND p.bank_account_id IS NOT NULL AND p.created_at >= $2
       GROUP BY p.bank_account_id, a.label`,
      [vendorId, since]
    );
    for (const r of parcial || []) {
      const cur = map.get(String(r.bank_account_id)) || { label: r.label || "Cuenta", count: 0, total: 0 };
      cur.count += Number(r.cnt) || 0;
      cur.total += Number(r.total) || 0;
      if (r.label) cur.label = r.label;
      map.set(String(r.bank_account_id), cur);
    }
  } catch {
    /* sin migración: sin desglose */
  }

  if (hasOrdersBankCol) {
    try {
      const rows = await queryMany<{ bank_account_id: string; label: string | null; total: number; cnt: number }>(
        `SELECT o.bank_account_id, a.label, SUM(o.total) AS total, COUNT(*)::int AS cnt
         FROM orders o
         LEFT JOIN vendor_bank_accounts a ON a.id = o.bank_account_id
         WHERE o.vendor_id = $1 AND o.payment_method = 'transferencia'
           AND o.bank_account_id IS NOT NULL
           AND o.paid_at IS NOT NULL AND o.paid_at >= $2 AND o.status != 'cancelled'
           AND COALESCE(o.paid_via_payments, false) = false
           ${notAdjustment}
         GROUP BY o.bank_account_id, a.label`,
        [vendorId, since]
      );
      for (const r of rows || []) {
        const cur = map.get(String(r.bank_account_id)) || { label: r.label || "Cuenta", count: 0, total: 0 };
        cur.count += Number(r.cnt) || 0;
        cur.total += Number(r.total) || 0;
        if (r.label) cur.label = r.label;
        map.set(String(r.bank_account_id), cur);
      }
    } catch {
      /* sin migración */
    }
  }

  if (hasBookingsBankCol) {
    try {
      const rows = await queryMany<{ bank_account_id: string; label: string | null; amount: number }>(
        `SELECT b.bank_account_id, a.label, b.amount_paid AS amount
         FROM bookings b
         LEFT JOIN vendor_bank_accounts a ON a.id = b.bank_account_id
         WHERE b.vendor_id = $1 AND b.payment_method = 'transferencia'
           AND b.bank_account_id IS NOT NULL
           AND b.paid_at IS NOT NULL AND b.paid_at >= $2
           AND COALESCE(b.payment_status, '') = 'paid'
           AND COALESCE(b.amount_paid, 0) > 0
           AND COALESCE(b.status, '') <> 'cancelled'`,
        [vendorId, since]
      );
      for (const r of rows || []) {
        const cur = map.get(String(r.bank_account_id)) || { label: r.label || "Cuenta", count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(r.amount) || 0;
        if (r.label) cur.label = r.label;
        map.set(String(r.bank_account_id), cur);
      }
    } catch {
      /* sin migración */
    }
  }

  const out = Array.from(map.entries()).map(([accountId, v]) => ({
    accountId,
    label: v.label,
    count: v.count,
    total: Math.round(v.total * 100) / 100,
  }));
  return out.sort((a, b) => b.total - a.total);
}

export async function computeCashClosing(
  vendorId: string,
  since: string
): Promise<CashClosingSummary> {
  // Pedidos SIN desglose (online y anteriores a la migración): el medio
  // único de siempre. Los que tienen filas en order_payments quedan
  // marcados con paid_via_payments y no se cuentan dos veces.
  const paymentsTable = await hasPaymentsTable();
  const viaFlag = paymentsTable
    ? `AND COALESCE(o.paid_via_payments, false) = false`
    : "";
  const notAdjustment = await adjustmentSalesFilter("o");
  const rows = await queryMany<{
    payment_method: string | null;
    total: number;
    cash_discount: number | null;
  }>(
    `SELECT o.payment_method, o.total, o.cash_discount
     FROM orders o
     WHERE o.vendor_id = $1 AND o.paid_at IS NOT NULL AND o.paid_at >= $2 AND o.status != 'cancelled' ${viaFlag} ${notAdjustment}`,
    [vendorId, since]
  );

  // Cobros de turnos (servicios / estética / oficios): no viven en `orders`,
  // pero son ingresos del período y deben aparecer en el cierre por medio de
  // pago, igual que gastronomía. Tolerante a migración sin aplicar.
  const bookingRows: Array<{ payment_method: string | null; amount_paid: number }> = [];
  if (await hasColumn("bookings", "paid_at")) {
    const brows = await queryMany<{ payment_method: string | null; amount_paid: number }>(
      `SELECT payment_method, amount_paid
       FROM bookings
       WHERE vendor_id = $1 AND paid_at IS NOT NULL AND paid_at >= $2
         AND COALESCE(payment_status, '') = 'paid'
         AND COALESCE(amount_paid, 0) > 0
         AND COALESCE(status, '') <> 'cancelled'
         AND COALESCE(payment_method, 'efectivo') <> 'fiado'`,
      [vendorId, since]
    ).catch(() => []);
    for (const b of brows || []) bookingRows.push(b);
  }

  // Señas cobradas por MP/Stripe en turnos y consultas: se suman al total
  // del período en el momento en que se acreditaron (deposit_paid_at).
  // Tolerante a migración sin aplicar (deposit_paid_at puede no existir).
  const depositRows: Array<{ deposit_method: string | null; deposit_amount: number }> = [];
  if (await hasColumn("bookings", "deposit_paid_at")) {
    const drows = await queryMany<{ deposit_method: string | null; deposit_amount: number }>(
      `SELECT deposit_method, deposit_amount
       FROM bookings
       WHERE vendor_id = $1 AND deposit_status = 'paid'
         AND deposit_paid_at IS NOT NULL AND deposit_paid_at >= $2
         AND COALESCE(deposit_amount, 0) > 0
         AND COALESCE(status, '') <> 'cancelled'`,
      [vendorId, since]
    ).catch(() => []);
    for (const d of drows || []) depositRows.push(d);
  }
  if (await hasColumn("quotes", "deposit_paid_at")) {
    const qrows = await queryMany<{ deposit_method: string | null; deposit_amount: number }>(
      `SELECT deposit_method, deposit_amount
       FROM quotes
       WHERE vendor_id = $1 AND deposit_status = 'paid'
         AND deposit_paid_at IS NOT NULL AND deposit_paid_at >= $2
         AND COALESCE(deposit_amount, 0) > 0`,
      [vendorId, since]
    ).catch(() => []);
    for (const d of qrows || []) depositRows.push(d);
  }

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
  for (const b of bookingRows) {
    const amount = Number(b.amount_paid) || 0;
    if (!(amount > 0)) continue;
    const m = b.payment_method || "efectivo";
    if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
    byMethod[m].count++;
    byMethod[m].total += amount;
    gross += amount;
    net += amount;
  }

  // Señas (MP/Stripe) del período: se suman al total como ingreso aparte,
  // agrupadas por medio, y se exponen como subtotal informativo.
  const depositsByMethod: Record<string, ClosingMethodTotals> = {};
  let depositsTotal = 0;
  let depositsCount = 0;
  for (const d of depositRows) {
    const amount = Number(d.deposit_amount) || 0;
    if (!(amount > 0)) continue;
    const m = d.deposit_method || "mercadopago";
    if (!depositsByMethod[m]) depositsByMethod[m] = { count: 0, total: 0 };
    depositsByMethod[m].count++;
    depositsByMethod[m].total += amount;
    depositsCount++;
    depositsTotal += amount;
    if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
    byMethod[m].count++;
    byMethod[m].total += amount;
    gross += amount;
    net += amount;
  }
  for (const d of Object.values(depositsByMethod)) d.total = round2(d.total);

  // Egresos del libro de Gastos (manual + compras) del período.
  const gastosPeriodo = await fetchPeriodGastos(vendorId, since);

  // Ingresos manuales (packs/giftcards) del período.
  const manualIncomePeriodo = await fetchPeriodManualIncome(vendorId, since);

  // Ingresos manuales: suman al total del período por medio de pago.
  for (const [m, d] of Object.entries(manualIncomePeriodo.byMethod)) {
    if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
    byMethod[m].count += d.count;
    byMethod[m].total += d.total;
    gross += d.total;
    net += d.total;
  }

  // Desglose de cobros (pago combinado / medio real del cierre de mesa y
  // cobros parciales): suma al bucket de cada medio. El bruto y el neto
  // siguen saliendo de los pedidos (valor de la venta); esto es cómo se
  // cobró, que es lo que el arqueo necesita.
  const transferByAccount = await fetchTransferByAccount(vendorId, since);
  if (paymentsTable) {
    const paymentsByMethod = await fetchPaymentsByMethod(vendorId, since);
    for (const [m, d] of Object.entries(paymentsByMethod)) {
      if (!byMethod[m]) byMethod[m] = { count: 0, total: 0 };
      byMethod[m].count += d.count;
      byMethod[m].total += d.total;
    }
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
    ordersCount: rows.length + bookingRows.length,
    grossTotal: round2(gross),
    discountsTotal: round2(discounts),
    netTotal: round2(net),
    byMethod: rounded,
    transferByAccount,
    cashTotal: rounded["efectivo"]?.total ?? 0,
    avgTicket: (rows.length + bookingRows.length) > 0 ? round2(net / (rows.length + bookingRows.length)) : 0,
    senasTotal: round2(senasTotal),
    senasCount,
    senasByMethod,
    depositsTotal: round2(depositsTotal),
    depositsCount,
    depositsByMethod,
    egresosGastos: gastosPeriodo.total,
    egresosGastosCount: gastosPeriodo.count,
    gastosEfectivo: gastosPeriodo.efectivo,
    manualIncomeTotal: manualIncomePeriodo.total,
    manualIncomeCount: manualIncomePeriodo.count,
    manualIncomeByMethod: manualIncomePeriodo.byMethod,
  };
}
