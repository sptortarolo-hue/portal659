import { hasTable, type Tx } from "@/lib/db";

/**
 * Kardex append-only (tolerante a migración sin aplicar: si la tabla no
 * existe, no hace nada). Guard con hasTable ANTES de tocar la tabla: el
 * patrón try/catch ciego envenena la transacción (25P02 en toda query
 * posterior), que es peor que el fallo que quería evitar.
 * Con tabla existente NO se tragan errores: rollback limpio de la tx.
 */
export type StockMoveReason =
  | "compra"
  | "venta"
  | "conteo"
  | "merma"
  | "devolucion"
  | "manual"
  | "apartado"
  | "orden";

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
    /** Orden de servicio (taller): referenciada en la migración v3. */
    ref_booking?: string | null;
    created_by?: string | null;
  }
): Promise<void> {
  if (!move.vendorId || (!move.product_id && !move.variant_id && !move.ingredient_id)) return;
  if (!Number.isFinite(Number(move.qty_delta)) || Number(move.qty_delta) === 0) return;
  if (!(await hasTable(tx, "stock_ledger"))) return;
  // ref_booking: columna de migrate-taller-v3.sql (tolerante a migración sin
  // aplicar). Se consulta information_schema ANTES de insertar: un catch
  // dentro de la tx la envenenaría (25P02).
  let hasBookingRef = false;
  if (move.ref_booking) {
    const col = await tx
      .queryOne<{ e: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'stock_ledger' AND column_name = 'ref_booking'
         ) AS e`,
        []
      )
      .catch(() => ({ e: false }) as { e: boolean } | undefined);
    hasBookingRef = col?.e === true;
  }
  const vals = [
    move.vendorId,
    move.product_id || null,
    move.variant_id || null,
    move.ingredient_id || null,
    Number(move.qty_delta),
    move.reason,
    move.ref_order || null,
    move.ref_purchase || null,
    move.ref_count || null,
    ...(hasBookingRef ? [move.ref_booking || null] : []),
    move.created_by || null,
  ];
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
  await tx.queryVoid(
    `INSERT INTO stock_ledger (vendor_id, product_id, variant_id, ingredient_id, qty_delta, reason, ref_order, ref_purchase, ref_count${hasBookingRef ? ", ref_booking" : ""}, created_by)
     VALUES (${placeholders})`,
    vals
  );
}
