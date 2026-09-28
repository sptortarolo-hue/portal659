import type { Tx } from "@/lib/db";

/**
 * Kardex append-only (tolerante a migración sin aplicar: si la tabla no
 * existe, no hace nada). Nunca lanza: un fallo de auditoría no puede romper
 * una venta.
 */
export type StockMoveReason =
  | "compra"
  | "venta"
  | "conteo"
  | "merma"
  | "devolucion"
  | "manual"
  | "apartado";

export async function logStockMovement(
  tx: Tx,
  move: {
    vendorId: string;
    product_id?: string | null;
    variant_id?: string | null;
    ingredient_id?: string | null;
    qty_delta: number;
    reason: StockMoveReason;
    ref_order?: string | null;
    ref_purchase?: string | null;
    ref_count?: string | null;
    created_by?: string | null;
  }
): Promise<void> {
  if (!move.vendorId || (!move.product_id && !move.variant_id && !move.ingredient_id)) return;
  if (!Number.isFinite(Number(move.qty_delta)) || Number(move.qty_delta) === 0) return;
  try {
    await tx.queryVoid(
      `INSERT INTO stock_ledger (vendor_id, product_id, variant_id, ingredient_id, qty_delta, reason, ref_order, ref_purchase, ref_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        move.vendorId,
        move.product_id || null,
        move.variant_id || null,
        move.ingredient_id || null,
        Number(move.qty_delta),
        move.reason,
        move.ref_order || null,
        move.ref_purchase || null,
        move.ref_count || null,
        move.created_by || null,
      ]
    );
  } catch {
    /* tabla sin migrar: auditoría omitida */
  }
}
