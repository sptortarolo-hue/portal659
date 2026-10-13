import { randomBytes } from "crypto";
import type { Tx } from "@/lib/db";

/**
 * Giftcards compartidas (estética, comercio, moda). Sin gate de plan
 * (igual que estética hoy): solo importan vertical + MP conectado.
 * Tablas agnósticas al vertical (vendor_id); solo cambia el prefijo.
 */

export const GIFT_VERTICALS = ["estetica", "comercio", "moda"] as const;

export function canSellGiftcards(vertical: string | null | undefined): boolean {
  return !!vertical && (GIFT_VERTICALS as readonly string[]).includes(vertical);
}

export function giftCodePrefix(vertical: string | null | undefined): string {
  if (vertical === "comercio") return "COM";
  if (vertical === "moda") return "MOD";
  return "EST";
}

export function newGiftCode(vertical: string | null | undefined): string {
  return `${giftCodePrefix(vertical)}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Monto válido: >0 y con 2 decimales como máximo (pesos). */
export function normalizeGiftAmount(raw: unknown): number | null {
  const n = Math.round(Number(raw) || 0);
  return n > 0 ? n : null;
}

export type GiftcardConsumeResult = { id: string; code: string; applied: number } | null;

/**
 * Descuenta saldo de forma atómica (una sola sentencia: el UPDATE valida
 * estado/vencimiento/saldo, así que dos canjes simultáneos no duplican).
 * Registra el movimiento kind='redeem'. Devuelve lo aplicado o null.
 */
export async function consumeGiftcard(
  tx: Tx,
  opts: { vendorId: string; code: string; maxAmount: number; note?: string | null }
): Promise<GiftcardConsumeResult> {
  const code = String(opts.code || "").trim().toUpperCase();
  const cap = Math.round(Number(opts.maxAmount) || 0);
  if (!opts.vendorId || !code || !(cap > 0)) return null;
  const row = await tx.queryOne<{ id: string; code: string; applied: number }>(
    `WITH c AS (
       SELECT id, code, LEAST(balance, $3) AS applied FROM giftcards
       WHERE vendor_id = $1 AND code = $2 AND status = 'active'
         AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
         AND balance > 0
       LIMIT 1
     )
     UPDATE giftcards g SET balance = g.balance - c.applied,
       status = CASE WHEN g.balance - c.applied <= 0 THEN 'redeemed' ELSE 'active' END
     FROM c WHERE g.id = c.id
     RETURNING g.id, g.code, c.applied`,
    [opts.vendorId, code, cap]
  );
  if (!row) return null;
  const applied = Math.round(Number(row.applied) || 0);
  if (!(applied > 0)) return null;
  await tx.queryVoid(
    `INSERT INTO giftcard_moves (giftcard_id, kind, amount, note) VALUES ($1, 'redeem', $2, $3)`,
    [row.id, applied, opts.note != null ? String(opts.note).slice(0, 200) : null]
  ).catch(() => undefined);
  return { id: row.id, code: row.code, applied };
}
