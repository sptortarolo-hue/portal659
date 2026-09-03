import type { Tx } from "@/lib/db";
import type { OrderItem } from "@/types/database";

/** Error de negocio: no hay stock suficiente para reservar un ítem. */
export class OutOfStockError extends Error {
  constructor(public itemName: string) {
    super(`Sin stock suficiente de "${itemName}"`);
    this.name = "OutOfStockError";
  }
}

/**
 * Ajusta el stock de los ítems de un pedido.
 * - `decrement`: reserva al crear el pedido. Valida disponibilidad y lanza
 *   OutOfStockError si no alcanza (la transacción hace rollback).
 * - `increment`: reposición al cancelar/rechazar.
 *
 * Solo se tocan ítems con `variant_id` (variantes de moda) o `product_id`
 * de un producto con `stock_control` activo. El resto no lleva stock.
 * Pensado para correr DENTRO de la transacción del pedido.
 */
export async function adjustStockForItems(
  tx: Tx,
  items: OrderItem[] | null | undefined,
  direction: "decrement" | "increment"
): Promise<void> {
  for (const item of items || []) {
    if (!item) continue;
    const qty = Math.max(1, Number(item.qty) || 1);

    if (item.variant_id) {
      if (direction === "increment") {
        await tx.queryVoid(
          `UPDATE product_variants SET stock = stock + $1 WHERE id = $2`,
          [qty, item.variant_id]
        );
      } else {
        const rows = await tx.query<{ id: string }>(
          `UPDATE product_variants SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id`,
          [qty, item.variant_id]
        );
        if (rows.length === 0) throw new OutOfStockError(item.name);
      }
      continue;
    }

    if (item.product_id) {
      if (direction === "increment") {
        await tx.queryVoid(
          `UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock_control = true`,
          [qty, item.product_id]
        );
      } else {
        const rows = await tx.query<{ id: string }>(
          `UPDATE products SET stock = stock - $1
           WHERE id = $2 AND stock_control = true AND COALESCE(stock, 0) >= $1
           RETURNING id`,
          [qty, item.product_id]
        );
        if (rows.length === 0) {
          // Si el producto no controla stock no hay nada que reservar.
          const p = await tx.queryOne<{ stock_control: boolean }>(
            `SELECT stock_control FROM products WHERE id = $1 LIMIT 1`,
            [item.product_id]
          );
          if (p?.stock_control) throw new OutOfStockError(item.name);
        }
      }
    }
  }
}
