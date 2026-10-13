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

export type IssuedGiftcard = { id: string; code: string; amount: number };

export type OrderGiftItem = {
  product_id?: string | null;
  qty?: number | null;
};

/**
 * Emisión automática de giftcards vendidas (1 código por unidad).
 * Idempotente por (vendor, pedido, producto, unidad): reintentos, doble
 * webhook o doble cobro no duplican códigos (UNIQUE parcial de
 * migrate-giftcard-issue.sql + pre-chequeo + ON CONFLICT).
 * Nunca emite en preview. Tolerante a migración sin aplicar (emite sin
 * vínculo + move 'adjust' como fallback).
 */
export async function issueGiftcardsForOrder(
  tx: Tx,
  opts: {
    vendorId: string;
    orderId: string;
    items: OrderGiftItem[] | null | undefined;
    customerName?: string | null;
    customerPhone?: string | null;
    isPreview?: boolean;
    note?: string | null;
  }
): Promise<IssuedGiftcard[]> {
  const out: IssuedGiftcard[] = [];
  if (opts.isPreview) return out;
  if (!opts.vendorId || !opts.orderId) return out;
  const items = (Array.isArray(opts.items) ? opts.items : []).filter(
    (i) => i && typeof i.product_id === "string" && i.product_id
  );
  if (items.length === 0) return out;

  const vendor = await tx
    .queryOne<{ vertical: string | null }>(`SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`, [opts.vendorId])
    .catch(() => null);
  const vertical = vendor?.vertical ?? null;

  // Productos giftcard del comercio (monto = precio del producto).
  const ids = [...new Set(items.map((i) => String(i.product_id)))];
  const pros = await tx
    .query<{ id: string; price: number }>(
      `SELECT id, price FROM products
       WHERE vendor_id = $1 AND id = ANY($2)
         AND (sku LIKE 'GC-%' OR lower(category) = 'giftcards')`,
      [opts.vendorId, ids]
    )
    .catch(() => [] as { id: string; price: number }[]);
  const priceById = new Map(
    (pros || []).map((p) => [String(p.id), Math.round(Number(p.price)) || 0])
  );
  if (priceById.size === 0) return out;

  const hasOrderCols =
    (
      await tx
        .queryOne<{ e: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'giftcards' AND column_name = 'order_id') AS e`
        )
        .catch(() => null)
    )?.e === true;

  const buyer = String(opts.customerName || "").trim().slice(0, 120) || null;
  const phone = String(opts.customerPhone || "").trim().slice(0, 40) || null;
  const note = String(opts.note || "").trim().slice(0, 200) || null;

  for (const item of items) {
    const pid = String(item.product_id);
    const unitPrice = priceById.get(pid);
    if (!(unitPrice && unitPrice > 0)) continue;
    const qty = Math.max(1, Math.min(200, Math.round(Number(item.qty) || 1)));
    for (let u = 0; u < qty; u++) {
      // Idempotencia: ¿ya se emitió esta unidad?
      if (hasOrderCols) {
        const prev = await tx
          .queryOne<IssuedGiftcard>(
            `SELECT id, code, amount FROM giftcards
             WHERE vendor_id = $1 AND order_id = $2 AND product_id = $3 AND unit_index = $4 LIMIT 1`,
            [opts.vendorId, opts.orderId, pid, u]
          )
          .catch(() => null);
        if (prev) {
          out.push({ id: String(prev.id), code: String(prev.code), amount: Math.round(Number(prev.amount)) || 0 });
          continue;
        }
      }
      // Emite (reintenta código ante colisión).
      let created: IssuedGiftcard | null = null;
      for (let i = 0; i < 5 && !created; i++) {
        const code = newGiftCode(vertical);
        try {
          const row = hasOrderCols
            ? await tx.queryOne<{ id: string; code: string; amount: number }>(
                `INSERT INTO giftcards (vendor_id, code, amount, balance, customer_name, customer_phone, order_id, product_id, unit_index)
                 VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT DO NOTHING RETURNING id, code, amount`,
                [opts.vendorId, code, unitPrice, buyer, phone, opts.orderId, pid, u]
              )
            : await tx.queryOne<{ id: string; code: string; amount: number }>(
                `INSERT INTO giftcards (vendor_id, code, amount, balance, customer_name, customer_phone)
                 VALUES ($1, $2, $3, $3, $4, $5)
                 ON CONFLICT DO NOTHING RETURNING id, code, amount`,
                [opts.vendorId, code, unitPrice, buyer, phone]
              );
          if (row) {
            created = { id: String(row.id), code: String(row.code), amount: Math.round(Number(row.amount)) || 0 };
          } else if (hasOrderCols) {
            // Carrera: otro proceso la emitió → traer la ganadora.
            const winner = await tx
              .queryOne<IssuedGiftcard>(
                `SELECT id, code, amount FROM giftcards
                 WHERE vendor_id = $1 AND order_id = $2 AND product_id = $3 AND unit_index = $4 LIMIT 1`,
                [opts.vendorId, opts.orderId, pid, u]
              )
              .catch(() => null);
            if (winner) {
              created = { id: String(winner.id), code: String(winner.code), amount: Math.round(Number(winner.amount)) || 0 };
            }
          }
        } catch (e) {
          if (!/duplicate|unique/i.test((e as Error)?.message || "")) throw e;
        }
      }
      if (!created) continue;
      // Historial de emisión (tolerante al CHECK viejo sin 'issue').
      const moveNote = note || `Venta (pedido ${opts.orderId.slice(0, 8)})`;
      await tx
        .queryVoid(`INSERT INTO giftcard_moves (giftcard_id, kind, amount, note) VALUES ($1, 'issue', $2, $3)`, [
          created.id,
          created.amount,
          moveNote,
        ])
        .catch(async () => {
          await tx
            .queryVoid(`INSERT INTO giftcard_moves (giftcard_id, kind, amount, note) VALUES ($1, 'adjust', $2, $3)`, [
              created!.id,
              created!.amount,
              `emisión: ${moveNote}`,
            ])
            .catch(() => undefined);
        });
      out.push(created);
    }
  }
  return out;
}

/**
 * Anula los códigos emitidos por una venta cancelada/borrada (solo activos).
 * La plata vuelve a foja cero: sin código válido no hay canje posterior.
 */
export async function voidGiftcardsForOrder(
  tx: Tx,
  opts: { vendorId: string; orderId: string; note?: string | null }
): Promise<number> {
  if (!opts.vendorId || !opts.orderId) return 0;
  const rows = await tx
    .query<{ id: string }>(
      `UPDATE giftcards SET status = 'void'
       WHERE vendor_id = $1 AND order_id = $2 AND status = 'active'
       RETURNING id`
    ,[opts.vendorId, opts.orderId])
    .catch(() => [] as { id: string }[]);
  const note = String(opts.note || "venta cancelada").slice(0, 200);
  for (const r of rows || []) {
    await tx
      .queryVoid(`INSERT INTO giftcard_moves (giftcard_id, kind, amount, note) VALUES ($1, 'adjust', 0, $2)`, [
        String(r.id),
        note,
      ])
      .catch(() => undefined);
  }
  return (rows || []).length;
}
