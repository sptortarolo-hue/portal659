import type { Tx } from "@/lib/db";
import type * as Db from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { isRealCustomerPhone } from "@/lib/customers";

/**
 * Fiado / cuenta corriente (tolerante a migración sin aplicar: si la tabla
 * no existe, balance 0 y las escrituras se omiten sin romper la venta).
 */

export type FiadoBalance = {
  phone: string;
  balance: number;
  charges: number;
  payments: number;
  pendingOrders: { id: string; total: number; created_at: string; pickup_number: number | null }[];
};

export async function fiadoTableReady(
  queryOne: (sql: string, params?: unknown[]) => Promise<any>
): Promise<boolean> {
  try {
    const r = await queryOne(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'account_moves') AS exists`
    );
    return r?.exists === true;
  } catch {
    return false;
  }
}

/** Saldo y pendientes de un teléfono (E.164). */
export async function getFiadoBalance(
  queryMany: typeof Db.queryMany,
  vendorId: string,
  phoneE164: string
): Promise<FiadoBalance> {
  const empty: FiadoBalance = { phone: phoneE164, balance: 0, charges: 0, payments: 0, pendingOrders: [] };
  let moves: { kind: string; amount: number }[] = [];
  try {
    moves =
      (await queryMany<{ kind: string; amount: number }>(
        `SELECT kind, amount FROM account_moves WHERE vendor_id = $1 AND customer_phone = $2`,
        [vendorId, phoneE164]
      )) || [];
  } catch {
    return empty;
  }
  let charges = 0;
  let payments = 0;
  for (const m of moves) {
    const a = Number(m.amount) || 0;
    if (m.kind === "charge") charges += a;
    else if (m.kind === "payment") payments += a;
  }
  let pendingOrders: FiadoBalance["pendingOrders"] = [];
  try {
    pendingOrders =
      ((await queryMany<FiadoBalance["pendingOrders"][number]>(
        `SELECT id, total, created_at, pickup_number FROM orders
         WHERE vendor_id = $1 AND customer_phone = $2 AND payment_method = 'fiado'
           AND paid_at IS NULL AND status <> 'cancelled' AND COALESCE(is_preview, false) = false
         ORDER BY created_at ASC`,
        [vendorId, phoneE164]
      )) as FiadoBalance["pendingOrders"]) || [];
  } catch {
    pendingOrders = [];
  }
  const balance = Math.round((charges - payments) * 100) / 100;
  return { phone: phoneE164, balance, charges, payments, pendingOrders };
}

/**
 * Imputa un pago a los fiados pendientes del más viejo al más nuevo.
 * Al cubrirse un pedido se marca paid_at (entra al Z) y payment_status paid.
 * Devuelve los ids cubiertos. Corre DENTRO de la tx del llamador.
 */
export async function imputeFiadoPayment(
  tx: Tx,
  vendorId: string,
  phoneE164: string,
  amount: number,
  now: string
): Promise<{ coveredIds: string[]; remaining: number }> {
  let remaining = Math.round(Number(amount) * 100) / 100;
  const coveredIds: string[] = [];
  if (!Number.isFinite(remaining) || remaining <= 0) return { coveredIds, remaining: 0 };
  let pending: { id: string; total: number }[] = [];
  try {
    pending =
      (await tx.query<{ id: string; total: number }>(
        `SELECT id, total FROM orders
         WHERE vendor_id = $1 AND customer_phone = $2 AND payment_method = 'fiado'
           AND paid_at IS NULL AND status <> 'cancelled' AND COALESCE(is_preview, false) = false
         ORDER BY created_at ASC FOR UPDATE`,
        [vendorId, phoneE164]
      )) || [];
  } catch {
    return { coveredIds, remaining };
  }
  for (const o of pending) {
    if (remaining < Number(o.total)) break;
    remaining = Math.round((remaining - Number(o.total)) * 100) / 100;
    await tx.queryVoid(
      `UPDATE orders SET paid_at = $1, payment_status = 'paid' WHERE id = $2`,
      [now, o.id]
    );
    coveredIds.push(o.id);
  }
  return { coveredIds, remaining };
}

/** Valida teléfono para fiado: real (WhatsApp) y distinto al del comercio. */
export function validateFiadoPhone(phone: string, vendorWhatsapp?: string | null): string | null {
  const clean = typeof phone === "string" ? phone.trim() : "";
  const e164 = toE164(clean);
  if (!e164) return null;
  if (!isRealCustomerPhone(clean, vendorWhatsapp || null)) return null;
  return e164;
}
