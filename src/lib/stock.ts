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
 *
 * Devuelve los movimientos EFECTIVOS (para kardex): solo lo que realmente
 * cambió stock (los no-op sin stock_control no se reportan).
 */
export type StockMove = {
  product_id?: string;
  variant_id?: string;
  qty: number;
};

/**
 * Resuelve los componentes de un combo directamente desde la DB.
 * Fallback para flujos que no pasan `combo_members` (ej. webhook MP para
 * combos simples). Tolerante a la tabla inexistente (migración sin aplicar).
 * Devuelve null si el producto no es combo o la tabla no existe.
 */
async function resolveComboMembersFromDb(
  tx: Tx,
  productId: string
): Promise<{ product_id: string; qty: number }[] | null> {
  try {
    const t = await tx.query<{ ok: boolean }>(
      `SELECT to_regclass('public.combo_items') IS NOT NULL AS ok`
    );
    if (!t[0]?.ok) return null;
    const crows = await tx.query<{ member_product_id: string; qty: number }>(
      `SELECT member_product_id, qty FROM combo_items WHERE combo_product_id = $1`,
      [productId]
    );
    if (crows.length === 0) return null;
    return crows.map((c) => ({
      product_id: String(c.member_product_id),
      qty: Math.max(1, Math.round(Number(c.qty) || 1)),
    }));
  } catch {
    return null;
  }
}

/**
 * Prepara los ítems para el movimiento de stock (venta o reposición).
 * - Excluye líneas por kilo (pesan y no descuentan por kg) y manuales.
 * - EXCEPCIÓN: líneas por kilo de productos "cuento paquetes" (envasado)
 *   entran como 1 PAQUETE por línea (cada etiqueta es una bolsa física).
 * Tolerante a la migración sin aplicar: sin la columna count_pack, kg no
 * descuenta stock, como siempre.
 */
export async function stockItemsForMovement(
  tx: Tx,
  vendorId: string,
  items: OrderItem[] | null | undefined
): Promise<OrderItem[]> {
  const arr = items || [];
  const normal = arr.filter((i) => (i as any)?.unit !== "kg");
  const kgLines = arr.filter((i) => (i as any)?.unit === "kg" && !(i as any)?.manual && (i as any)?.product_id);
  if (kgLines.length === 0) return normal as OrderItem[];
  try {
    const rows = await tx.query<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND count_pack = true AND id = ANY($2)`,
      [vendorId, [...new Set(kgLines.map((i) => String((i as any).product_id)))]]
    );
    const packIds = new Set((rows || []).map((r) => String(r.id)));
    return [
      ...(normal as OrderItem[]),
      ...kgLines
        .filter((i) => packIds.has(String((i as any).product_id)))
        .map((i) => ({ ...(i as any), qty: 1 }) as OrderItem),
    ];
  } catch {
    return normal as OrderItem[];
  }
}

export type AdjustStockOptions = {
  /**
   * Permite dejar el stock en negativo al descontar. Se usa SOLO en ventas
   * retrospectivas (ajuste post-cierre): el producto ya salió físicamente, así
   * que bloquear la corrección por falta de stock es peor que dejar el saldo
   * en negativo con aviso. En ventas normales se mantiene la validación.
   */
  allowNegative?: boolean;
};

export async function adjustStockForItems(
  tx: Tx,
  items: OrderItem[] | null | undefined,
  direction: "decrement" | "increment",
  options: AdjustStockOptions = {}
): Promise<StockMove[]> {
  const allowNegative = options.allowNegative === true;
  const moved: StockMove[] = [];
  for (const item of items || []) {
    if (!item) continue;
    const qty = Math.max(1, Number(item.qty) || 1);

    if (item.variant_id) {
      if (direction === "increment") {
        const rows = await tx.query<{ id: string }>(
          `UPDATE product_variants SET stock = stock + $1 WHERE id = $2 RETURNING id`,
          [qty, item.variant_id]
        );
        if (rows.length > 0) moved.push({ variant_id: item.variant_id, qty });
      } else {
        const rows = await tx.query<{ id: string }>(
          `UPDATE product_variants SET stock = stock - $1 WHERE id = $2 ${allowNegative ? "" : "AND stock >= $1"} RETURNING id`,
          [qty, item.variant_id]
        );
        if (rows.length === 0) throw new OutOfStockError(item.name);
        moved.push({ variant_id: item.variant_id, qty });
      }
      continue;
    }

    // Combo: descontar/reponer stock de cada componente (el combo en sí no
    // tiene stock propio; los componentes sí). Movimiento del kardex por
    // componente. Tolerante a DB sin la tabla (migración sin aplicar): el
    // combo se trata como un producto normal (no-op si no controla stock).
    // Con armado por unidad cada componente lleva variant_id: se toca la
    // VARIANTE (no el producto).
    let comboMembers = Array.isArray((item as any).combo_members)
      ? ((item as any).combo_members as {
          product_id: string;
          qty: number;
          variant_id?: string | null;
          color?: string | null;
          talle?: string | null;
          name?: string;
        }[])
      : null;
    // Fallback: si el pedido no trae los componentes (ej. MP para combos
    // simples), los resolvemos desde la DB para que el stock se descuente.
    if ((!comboMembers || comboMembers.length === 0) && item.product_id) {
      const resolved = await resolveComboMembersFromDb(tx, String(item.product_id));
      if (resolved && resolved.length > 0) {
        comboMembers = resolved as any;
      }
    }
    if (comboMembers && comboMembers.length > 0) {
      for (const m of comboMembers) {
        if (!m || !m.product_id) continue;
        const mqty = Math.max(1, Math.round(Number(m.qty) || 1)) * qty;
        const memberName = m.name || item.name;
        if (m.variant_id) {
          if (direction === "increment") {
            const rows = await tx.query<{ id: string }>(
              `UPDATE product_variants SET stock = stock + $1 WHERE id = $2 RETURNING id`,
              [mqty, m.variant_id]
            );
            if (rows.length > 0) moved.push({ variant_id: m.variant_id, qty: mqty });
          } else {
            const rows = await tx.query<{ id: string }>(
              `UPDATE product_variants SET stock = stock - $1 WHERE id = $2 ${allowNegative ? "" : "AND stock >= $1"} RETURNING id`,
              [mqty, m.variant_id]
            );
            if (rows.length === 0) throw new OutOfStockError(memberName);
            moved.push({ variant_id: m.variant_id, qty: mqty });
          }
          continue;
        }
        if (direction === "increment") {
          const rows = await tx.query<{ id: string }>(
            `UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock_control = true RETURNING id`,
            [mqty, m.product_id]
          );
          if (rows.length > 0) moved.push({ product_id: m.product_id, qty: mqty });
        } else {
          const rows = await tx.query<{ id: string }>(
            `UPDATE products SET stock = stock - $1
             WHERE id = $2 AND stock_control = true ${allowNegative ? "" : "AND COALESCE(stock, 0) >= $1"}
             RETURNING id`,
            [mqty, m.product_id]
          );
          if (rows.length === 0) {
            const p = await tx.queryOne<{ stock_control: boolean }>(
              `SELECT stock_control FROM products WHERE id = $1 LIMIT 1`,
              [m.product_id]
            );
            if (p?.stock_control) throw new OutOfStockError(memberName);
          } else {
            moved.push({ product_id: m.product_id, qty: mqty });
          }
        }
      }
      // Si el combo tiene control de stock prendido, también se descuenta/
      // repone el combo en sí (limita cuántos combos se venden, además del
      // stock de los componentes).
      if (direction === "increment") {
        const cRows = await tx.query<{ id: string }>(
          `UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock_control = true RETURNING id`,
          [qty, item.product_id]
        );
        if (cRows.length > 0) moved.push({ product_id: item.product_id, qty });
      } else {
        const cRows = await tx.query<{ id: string }>(
          `UPDATE products SET stock = stock - $1
           WHERE id = $2 AND stock_control = true ${allowNegative ? "" : "AND COALESCE(stock, 0) >= $1"}
           RETURNING id`,
          [qty, item.product_id]
        );
        if (cRows.length === 0) {
          const p = await tx.queryOne<{ stock_control: boolean }>(
            `SELECT stock_control FROM products WHERE id = $1 LIMIT 1`,
            [item.product_id]
          );
          if (p?.stock_control) throw new OutOfStockError(item.name);
        } else {
          moved.push({ product_id: item.product_id, qty });
        }
      }
      continue;
    }

    if (item.product_id) {
      if (direction === "increment") {
        const rows = await tx.query<{ id: string }>(
          `UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock_control = true RETURNING id`,
          [qty, item.product_id]
        );
        if (rows.length > 0) moved.push({ product_id: item.product_id, qty });
      } else {
        const rows = await tx.query<{ id: string }>(
          `UPDATE products SET stock = stock - $1
           WHERE id = $2 AND stock_control = true ${allowNegative ? "" : "AND COALESCE(stock, 0) >= $1"}
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
        } else {
          moved.push({ product_id: item.product_id, qty });
        }
      }
    }
  }
  return moved;
}
