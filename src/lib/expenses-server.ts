import { query, queryOne } from "@/lib/db";
import { normalizeExpenseCategory } from "@/lib/expenses";

/**
 * Inserta un gasto en el libro (idempotente por origen: un movimiento o
 * compra genera un solo gasto aunque se reintente). Tolerante a migración
 * sin aplicar: si falta la tabla, no hace nada (el flujo origen sigue).
 * Devuelve el id creado/existente o null.
 */
export async function recordExpense(input: {
  vendorId: string;
  source: "manual" | "caja" | "compra";
  sourceId?: string | null;
  category: string;
  amount: number;
  spentAt?: string | null;
  supplier?: string | null;
  note?: string | null;
  paymentMethod?: string | null;
  createdBy?: string | null;
}): Promise<string | null> {
  const category = normalizeExpenseCategory(input.category) ?? "Varios";
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!(amount > 0)) return null;
  let spentAt: string | null = null;
  if (typeof input.spentAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.spentAt)) {
    spentAt = input.spentAt;
  }
  try {
    if (input.sourceId) {
      const dup = await queryOne<{ id: string }>(
        `SELECT id FROM expenses WHERE vendor_id = $1 AND source = $2 AND source_id = $3 LIMIT 1`,
        [input.vendorId, input.source, input.sourceId]
      );
      if (dup) return dup.id;
    }
    const row = await queryOne<{ id: string }>(
      `INSERT INTO expenses (vendor_id, source, source_id, category, amount, spent_at, supplier, note, payment_method, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE), $7, $8, $9, $10)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        input.vendorId,
        input.source,
        input.sourceId || null,
        category,
        amount,
        spentAt,
        input.supplier?.trim().slice(0, 120) || null,
        input.note?.trim().slice(0, 280) || null,
        input.paymentMethod?.trim().slice(0, 40) || null,
        input.createdBy || null,
      ]
    );
    // ON CONFLICT DO NOTHING sin RETURNING cuando chocó con el índice único:
    // buscar el existente para devolver su id.
    if (row) return row.id;
    if (input.sourceId) {
      const dup = await queryOne<{ id: string }>(
        `SELECT id FROM expenses WHERE vendor_id = $1 AND source = $2 AND source_id = $3 LIMIT 1`,
        [input.vendorId, input.source, input.sourceId]
      );
      return dup?.id || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Borra el gasto linkeado a un origen (ej. al eliminar una compra). */
export async function deleteSourceExpense(
  vendorId: string,
  source: "caja" | "compra",
  sourceId: string
): Promise<void> {
  try {
    await query(`DELETE FROM expenses WHERE vendor_id = $1 AND source = $2 AND source_id = $3`, [
      vendorId,
      source,
      sourceId,
    ]);
  } catch {
    /* tolerante a migración sin aplicar */
  }
}
