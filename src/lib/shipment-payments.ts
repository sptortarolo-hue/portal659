import { queryMany, queryOne, withTransaction, type Tx } from "@/lib/db";

/**
 * Cobro de la logística al local al retirar el paquete.
 *
 * Modelo (v2): cada logística define su tarifa por zona
 * (`carrier_zone_rates`), que se congela en `shipments.carrier_fee` al
 * avisar el encargo. Al colectar, el operador registra el cobro
 * (`shipment_payments`): método, monto (editable sobre la tarifa), quién
 * pagó y nota. `status='pending'` = deuda documentada del local.
 *
 * Todo tolerante a migración sin aplicar (probes cacheados con TTL).
 */

/** Métodos de cobro (mismos que el panel del comercio, más "fiado"). */
export const SHIPMENT_PAYMENT_METHODS = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transferencia" },
  { key: "tarjeta", label: "💳 Tarjeta" },
  { key: "mixto", label: "🪙 Mixto" },
  { key: "fiado", label: "📓 Fiado (deuda)" },
] as const;

export type ShipmentPaymentMethod =
  (typeof SHIPMENT_PAYMENT_METHODS)[number]["key"];

export type ShipmentPaymentRow = {
  amount: number;
  method: ShipmentPaymentMethod | string;
  status: "paid" | "pending";
  payerName: string | null;
  note: string | null;
  paidAt: string | null;
};

const PROBE_TTL_MS = 60_000;
let feeColsOk: boolean | null = null;
let feeColsAt = 0;

/** ¿Existe `shipments.carrier_fee` + `shipment_payments`? */
export async function shipmentFeeColsReady(): Promise<boolean> {
  if (feeColsOk !== null && Date.now() - feeColsAt < PROBE_TTL_MS) return feeColsOk;
  try {
    await queryOne(`SELECT carrier_fee FROM shipments LIMIT 1`);
    await queryOne(`SELECT id FROM shipment_payments LIMIT 1`);
    feeColsOk = true;
  } catch {
    feeColsOk = false;
  }
  feeColsAt = Date.now();
  return feeColsOk;
}

/** Valida el payload de cobro del operador. Devuelve error o el cobro limpio. */
export function validateShipmentPayment(input: unknown): {
  error?: string;
  payment?: {
    amount: number;
    method: ShipmentPaymentMethod;
    payerName: string | null;
    note: string | null;
  };
} {
  const p = (input ?? {}) as Record<string, unknown>;
  if (p === null || typeof p !== "object") return {};
  const amount = Number(p.amount);
  if (!Number.isFinite(amount) || amount < 0 || amount > 99_999_999) {
    return { error: "El monto del cobro no es válido" };
  }
  const method = String(p.method ?? "efectivo");
  const valid = SHIPMENT_PAYMENT_METHODS.some((m) => m.key === method);
  if (!valid) return { error: "Método de cobro inválido" };
  const payerName =
    typeof p.payerName === "string" && p.payerName.trim()
      ? p.payerName.trim().slice(0, 80)
      : null;
  const note =
    typeof p.note === "string" && p.note.trim() ? p.note.trim().slice(0, 300) : null;
  return {
    payment: { amount: Math.round(amount * 100) / 100, method: method as ShipmentPaymentMethod, payerName, note },
  };
}

/**
 * Registra el cobro al retirar (idempotente por UNIQUE(shipment_id)):
 * si ya existe, lo actualiza. `fiado` → status 'pending' (deuda).
 * Se llama dentro de la misma transición del estado (mismo tx).
 */
export async function recordShipmentPaymentTx(
  tx: Tx,
  input: {
    shipmentId: string;
    vendorId: string;
    carrierId: string | null;
    collectedBy: string | null;
    amount: number;
    method: ShipmentPaymentMethod | string;
    payerName: string | null;
    note: string | null;
  }
): Promise<void> {
  const isDebt = input.method === "fiado";
  await tx.queryVoid(
    `INSERT INTO shipment_payments
       (shipment_id, vendor_id, carrier_id, amount, method, status, payer_name, note, paid_at, collected_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (shipment_id) DO UPDATE SET
       amount = EXCLUDED.amount,
       method = EXCLUDED.method,
       status = EXCLUDED.status,
       payer_name = EXCLUDED.payer_name,
       note = EXCLUDED.note,
       paid_at = EXCLUDED.paid_at,
       collected_by = EXCLUDED.collected_by`,
    [
      input.shipmentId,
      input.vendorId,
      input.carrierId,
      input.amount,
      input.method,
      isDebt ? "pending" : "paid",
      input.payerName,
      input.note,
      isDebt ? null : new Date().toISOString(),
      input.collectedBy,
    ]
  );
}

/** Cobro ya registrado de un encargo (null si no hay o falta la migración). */
export async function getShipmentPayment(
  shipmentId: string
): Promise<ShipmentPaymentRow | null> {
  try {
    const row = await queryOne<{
      amount: number;
      method: string;
      status: string;
      payer_name: string | null;
      note: string | null;
      paid_at: string | null;
    }>(
      `SELECT amount, method, status, payer_name, note, paid_at
       FROM shipment_payments WHERE shipment_id = $1 LIMIT 1`,
      [shipmentId]
    );
    if (!row) return null;
    return {
      amount: Number(row.amount) || 0,
      method: row.method,
      status: row.status === "pending" ? "pending" : "paid",
      payerName: row.payer_name != null ? String(row.payer_name) : null,
      note: row.note != null ? String(row.note) : null,
      paidAt: row.paid_at != null ? String(row.paid_at) : null,
    };
  } catch {
    return null;
  }
}

/** Cobros de varios encargos (para el listado del operador). */
export async function getShipmentPaymentsMap(
  shipmentIds: string[]
): Promise<Map<string, ShipmentPaymentRow>> {
  const map = new Map<string, ShipmentPaymentRow>();
  if (shipmentIds.length === 0) return map;
  try {
    const rows = await queryMany<{
      shipment_id: string;
      amount: number;
      method: string;
      status: string;
      payer_name: string | null;
      note: string | null;
      paid_at: string | null;
    }>(
      `SELECT shipment_id, amount, method, status, payer_name, note, paid_at
       FROM shipment_payments WHERE shipment_id = ANY($1::uuid[])`,
      [shipmentIds]
    );
    for (const r of rows || []) {
      map.set(String(r.shipment_id), {
        amount: Number(r.amount) || 0,
        method: r.method,
        status: r.status === "pending" ? "pending" : "paid",
        payerName: r.payer_name != null ? String(r.payer_name) : null,
        note: r.note != null ? String(r.note) : null,
        paidAt: r.paid_at != null ? String(r.paid_at) : null,
      });
    }
  } catch {
    /* sin migración: mapa vacío */
  }
  return map;
}

/** Tarifa vigente de un carrier para una zona (null = sin migrar/sin tarifa). */
export async function getCarrierZoneRate(
  carrierId: string | null,
  zoneId: string | null
): Promise<number | null> {
  if (!carrierId || !zoneId) return null;
  try {
    const row = await queryOne<{ fee: number }>(
      `SELECT fee FROM carrier_zone_rates WHERE carrier_id = $1 AND shipping_zone_id = $2 LIMIT 1`,
      [carrierId, zoneId]
    );
    return row ? Number(row.fee) : null;
  } catch {
    return null;
  }
}

/** Transacción auxiliar (para no importar withTransaction en cada ruta). */
export async function runInTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTransaction(fn);
}
