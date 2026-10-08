/**
 * Gastos: categorías y validación. Client-safe (sin imports de `pg`):
 * lo usan el manager, los modales de movimiento y el reporte A4.
 */

export const EXPENSE_CATEGORIES = [
  "Proveedores",
  "Servicios",
  "Alquiler",
  "Sueldos",
  "Impuestos",
  "Marketing",
  "Equipamiento",
  "Varios",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_SOURCES = ["manual", "caja", "compra"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];

export const EXPENSE_SOURCE_LABELS: Record<ExpenseSource, string> = {
  manual: "Manual",
  caja: "Caja",
  compra: "Compra",
};

/** Normaliza categoría (case-insensitive) o null si no es válida. */
export function normalizeExpenseCategory(v: unknown): ExpenseCategory | null {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return null;
  const found = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === t);
  return found ?? null;
}

export type Expense = {
  id: string;
  source: ExpenseSource;
  source_id: string | null;
  category: string;
  amount: number;
  spent_at: string;
  supplier: string | null;
  note: string | null;
  payment_method: string | null;
  created_by_name: string | null;
  created_at: string;
};
