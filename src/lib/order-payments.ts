/**
 * Pagos combinados (split payments): desglose real de cómo se cobró una
 * venta — una fila por medio de pago, cada una con su monto.
 *
 * Patrón de los POS de referencia (Square "Split payment", Toast/Upserve
 * con saldo restante, Shopify "Remaining to pay", Fudo "pagos múltiples"):
 * una venta tiene N "tenders" y el estado "pagado" se deriva de
 * `sum(amount) >= total`. El bucket de la Caja (Z) y el arqueo cuadran por
 * estos tenderes, no por el `payment_method` (valor único) de la orden.
 *
 * Server-only (usa `pg` directo). Los componentes client hablan con
 * `payment-split.tsx` / `cash-tender.ts`, no con este módulo.
 */
import { hasTable, queryMany, queryOne, type Tx } from "@/lib/db";

/** Medios que se pueden combinar en un cobro (los manuales del mostrador). */
export const SPLIT_METHODS = ["efectivo", "transferencia", "tarjeta"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const SPLIT_METHOD_LABEL: Record<SplitMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

/** Tope de medios por cobro (los POS usan 2-4; más que esto es ruido). */
export const MAX_SPLIT_PAYMENTS = 4;

/**
 * Holgura para que la suma cierre con el total REAL que calcula el server.
 * El cliente siempre manda su estimado (y el replay offline puede diferir
 * por cash/volumen/giftcard resueltos del lado servidor): una diferencia
 * chica se absorbe en el pago más grande; una más grande descarta el split
 * y la venta sigue como medio único (nunca se rompe la venta por esto).
 */
const ABSORB_TOLERANCE = 1;

export type SplitPayment = {
  method: SplitMethod;
  /** Monto APLICADO a la venta (no es lo que entregó el cliente). */
  amount: number;
  /** Efectivo: lo que entregó el cliente (>= amount). NULL = no se cargó. */
  tendered?: number | null;
  /** Cuenta destino cuando method === 'transferencia' (multi-cuenta). */
  bankAccountId?: string | null;
};

type Querier = {
  query: <T extends Record<string, any>>(sql: string, params?: unknown[]) => Promise<T[]>;
};

/** Adapter del pool a la firmina mínima de hasTable/queryMany. */
const POOL: Querier = {
  query: <T extends Record<string, any>>(sql: string, params: unknown[] = []) => queryMany<T>(sql, params),
};

export function isSplitMethod(m: unknown): m is SplitMethod {
  return typeof m === "string" && (SPLIT_METHODS as readonly string[]).includes(m);
}

/** Suma de los montos aplicados (redondeada a 2 decimales). */
export function sumPayments(payments: SplitPayment[] | null | undefined): number {
  return Math.round(((payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)) * 100) / 100;
}

/**
 * Medio "principal": el de mayor monto (empate → el primero). Queda en
 * `orders.payment_method` para que Kanban, tickets, filtros y analytics
 * sigan leyendo un valor único como siempre.
 */
export function primaryMethod(payments: SplitPayment[]): SplitMethod {
  if (payments.length === 0) return "efectivo";
  return [...payments].sort((a, b) => b.amount - a.amount)[0].method;
}

/**
 * Normaliza el split que manda el panel contra el total real.
 * Devuelve null si no hay desglose válido (vacío, métodos fuera de lista,
 * más de MAX, o una diferencia con el total que no se puede absorber): en
 * ese caso el caller sigue con el medio único de siempre.
 */
export function normalizeSplitPayments(raw: unknown, total: number): SplitPayment[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const tot = Math.max(0, Number(total) || 0);
  if (!(tot > 0)) return null;

  const rows: SplitPayment[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const m = (r as Record<string, unknown>).method;
    if (!isSplitMethod(m)) return null;
    const amount = Math.round((Number((r as Record<string, unknown>).amount) || 0) * 100) / 100;
    if (!(amount > 0)) continue; // líneas vacías del "sumar medio": se ignoran
    const tenderedRaw = Number((r as Record<string, unknown>).tendered);
    const tendered =
      m === "efectivo" && Number.isFinite(tenderedRaw) && tenderedRaw > 0
        ? Math.round(tenderedRaw * 100) / 100
        : null;
    const bankRaw = (r as Record<string, unknown>).bankAccountId ?? (r as Record<string, unknown>).bank_account_id;
    const bankAccountId =
      m === "transferencia" && typeof bankRaw === "string" && bankRaw.trim() ? bankRaw.trim() : null;
    rows.push({ method: m, amount, tendered: tendered != null && tendered >= amount ? tendered : null, bankAccountId });
  }
  if (rows.length === 0) return null;
  if (rows.length > MAX_SPLIT_PAYMENTS) return null;

  const sum = sumPayments(rows);
  const delta = Math.round((sum - tot) * 100) / 100;
  if (delta === 0) return rows;
  if (Math.abs(delta) > ABSORB_TOLERANCE) return null;

  // El pago de mayor monto absorbe la diferencia (queda > 0 salvo split
  // degenerado, que cae al medio único para no inventar montos negativos).
  const idx = rows.reduce((best, r, i) => (r.amount > rows[best].amount ? i : best), 0);
  const adjusted = Math.round((rows[idx].amount - delta) * 100) / 100;
  if (!(adjusted > 0)) return null;
  rows[idx] = {
    ...rows[idx],
    amount: adjusted,
    tendered: rows[idx].tendered != null && rows[idx].tendered >= adjusted ? rows[idx].tendered : null,
  };
  return rows;
}

/** ¿Existe la tabla de desglose? Tolerante a migración sin aplicar. */
export async function hasOrderPaymentsTable(q: Querier = POOL): Promise<boolean> {
  try {
    return await hasTable(q, "order_payments");
  } catch {
    return false;
  }
}

export type InsertPaymentsOpts = {
  vendorId: string;
  /** Pedido portador (mostrador / cierre de mesa). NULL en parciales. */
  orderId?: string | null;
  /** Mesa (cobro parcial y cierre): permite limpiar/consultar por mesa. */
  tableId?: string | null;
  kind?: "cobro" | "parcial";
  clientKey?: string | null;
  createdBy?: string | null;
  payments: SplitPayment[];
  /**
   * Reemplaza lo anterior del mismo ancla antes de insertar (default: sí
   * cuando hay pedido, el cobro de la venta es atómico con ella). Los
   * parciales de mesa son APPEND: cada uno es plata nueva que entró al
   * cajón, no una reescritura.
   */
  replace?: boolean;
};

/**
 * Inserta el desglose DENTRO de la transacción del cobro. Idempotente
 * cuando reemplaza: borra lo anterior del mismo (pedido o mesa+kind) antes
 * de insertar, así un reintento del sync no duplica filas.
 */
export async function insertOrderPayments(tx: Tx, opts: InsertPaymentsOpts): Promise<void> {
  if (opts.payments.length === 0) return;
  const kind = opts.kind ?? "cobro";
  const replace = opts.replace ?? !!opts.orderId;
  if (replace) {
    if (opts.clientKey) {
      await tx.query(`DELETE FROM order_payments WHERE vendor_id = $1 AND client_key = $2`, [
        opts.vendorId,
        opts.clientKey,
      ]);
    } else if (opts.orderId) {
      await tx.query(`DELETE FROM order_payments WHERE vendor_id = $1 AND order_id = $2 AND kind = $3`, [
        opts.vendorId,
        opts.orderId,
        kind,
      ]);
    } else if (opts.tableId) {
      await tx.query(`DELETE FROM order_payments WHERE vendor_id = $1 AND table_id = $2 AND kind = $3`, [
        opts.vendorId,
        opts.tableId,
        kind,
      ]);
    }
  }
  // Guarda contra FK/Migración parcial: si el profile del creador no existe
  // (o es preview), no rompemos la venta por un created_by inválido. Lo mismo
  // con `tendered`: si no cumple tendered >= amount, se descarta el tender
  // (la fila sigue válida; solo pierde el "Abona con" impreso).
  let createdBy: string | null = opts.createdBy ?? null;
  if (createdBy) {
    const prof = await tx.queryOne<{ id: string }>(
      `SELECT id FROM profiles WHERE id = $1 LIMIT 1`,
      [createdBy]
    ).catch(() => null);
    if (!prof) createdBy = null;
  }

  // Si la migración de multi-cuenta se aplicó, persistimos la cuenta destino
  // (solo transferencia). Si no se aplicó, se omite silenciosamente.
  let hasBankCol = false;
  try {
    const col = await tx.queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_payments' AND column_name = 'bank_account_id') AS exists`
    );
    hasBankCol = col?.exists === true;
  } catch {
    hasBankCol = false;
  }

  for (const p of opts.payments) {
    const tendered =
      p.method === "efectivo" && p.tendered != null && p.tendered >= p.amount
        ? p.tendered
        : null;
    const bankAccountId =
      hasBankCol && p.method === "transferencia" && p.bankAccountId ? p.bankAccountId : null;
    // ON CONFLICT DO NOTHING: si un reintento concurrente (o una colisión de
    // client_key) ya insertó la fila, no reventamos la venta. La fila existente
    // queda con los datos del primer intento (que es el mismo pago).
    const cols = [
      "vendor_id",
      "order_id",
      "table_id",
      "method",
      "amount",
      "tendered",
      "kind",
      "client_key",
      "created_by",
    ];
    const vals: unknown[] = [
      opts.vendorId,
      opts.orderId ?? null,
      opts.tableId ?? null,
      p.method,
      p.amount,
      tendered,
      kind,
      opts.clientKey ?? null,
      createdBy,
    ];
    if (hasBankCol) {
      cols.push("bank_account_id");
      vals.push(bankAccountId);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
    await tx.query(
      `INSERT INTO order_payments (${cols.join(", ")}) VALUES (${placeholders})
        ON CONFLICT (vendor_id, client_key) WHERE client_key IS NOT NULL DO NOTHING`,
      vals
    );
  }
}

/**
 * Desglose por pedido (ticket, detalle, Kanban). Indexado por order_id;
 * se recorta a N pedidos y se arma un Map en memoria.
 */
export async function fetchOrderPayments(
  vendorId: string,
  orderIds: string[]
): Promise<Record<string, SplitPayment[]>> {
  const ids = [...new Set((orderIds || []).filter(Boolean))].slice(0, 200);
  const out: Record<string, SplitPayment[]> = {};
  if (ids.length === 0) return out;
  try {
    let hasBankCol = false;
    try {
      const col = await queryOne<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'order_payments' AND column_name = 'bank_account_id') AS exists`
      );
      hasBankCol = col?.exists === true;
    } catch {
      hasBankCol = false;
    }
    const rows = await queryMany<{
      order_id: string;
      method: string;
      amount: number;
      tendered: number | null;
      bank_account_id: string | null;
    }>(
      `SELECT order_id, method, amount, tendered${hasBankCol ? ", bank_account_id" : ""}
       FROM order_payments
       WHERE vendor_id = $1 AND order_id = ANY($2) AND kind = 'cobro'
       ORDER BY created_at ASC, method ASC`,
      [vendorId, ids]
    );
    for (const r of rows || []) {
      if (!isSplitMethod(r.method)) continue;
      const id = String(r.order_id);
      if (!out[id]) out[id] = [];
      out[id].push({
        method: r.method,
        amount: Number(r.amount) || 0,
        tendered: r.tendered != null ? Number(r.tendered) || null : null,
        bankAccountId: (r as { bank_account_id?: string | null }).bank_account_id ?? null,
      });
    }
  } catch {
    // sin migración: sin desglose (el pedido muestra el medio único)
  }
  return out;
}
