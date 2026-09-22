import type { Order } from "@/types/database";

export type ApartadoInfo = {
  isApartado: boolean;
  /** Monto de la seña acordada. */
  deposit: number;
  /** % de seña sobre el total. */
  pct: number;
  depositPaid: boolean;
  /** Saldo pendiente (0 si está todo cobrado). */
  remainder: number;
  fullyPaid: boolean;
  /** Vencimiento como "dd/mm" (null si no hay fecha válida). */
  dueLabel: string | null;
  /** Vencido = pasó la fecha y falta cobrar el saldo (pedido activo). */
  overdue: boolean;
  /** No terminado (no completed/cancelled). */
  active: boolean;
};

/**
 * Resumen de apartado/seña para badges y acciones del panel.
 * Lógica de display pura (sin fechas relativas ni red): el vencimiento se
 * compara contra el inicio del día local.
 */
export function apartadoInfo(order: Order, now = Date.now()): ApartadoInfo {
  const isApartado = !!order.is_apartado;
  const total = Number(order.total) || 0;
  const deposit = Number(order.deposit_amount) || 0;
  const pct = Number(order.deposit_pct) || 0;
  const depositPaid = order.deposit_status === "paid";
  const fullyPaid = !!order.remainder_paid_at;
  const remainder = fullyPaid
    ? 0
    : Math.max(0, Math.round((total - (depositPaid ? deposit : 0)) * 100) / 100);
  let dueLabel: string | null = null;
  let overdue = false;
  if (order.deposit_due_at) {
    const d = new Date(order.deposit_due_at);
    if (!isNaN(d.getTime())) {
      dueLabel = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      overdue = !fullyPaid && d.getTime() < today.getTime();
    }
  }
  const active = !["completed", "cancelled"].includes(order.status);
  return { isApartado, deposit, pct, depositPaid, remainder, fullyPaid, dueLabel, overdue, active };
}
