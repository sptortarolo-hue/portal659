import { queryMany, queryOne } from "@/lib/db";
import { resolveVendorPlan } from "@/lib/plans";
import type { Plan, Vendor } from "@/types/database";

/**
 * Tope mensual de solicitudes para servicios (Fase 1): presupuestos + turnos
 * no cancelados del mes calendario. Espejo del tope de pedidos gastro
 * (max_orders_month). Un plan pago vigente (Oficios) resuelve NULL = ilimitado;
 * si vence, cae a la fila "gratuito" (5, configurable por admin).
 */
export async function getServiceQuota(vendorId: string): Promise<{
  used: number;
  limit: number | null;
  planSlug: string;
}> {
  const vendorRow = await queryOne<Record<string, unknown>>(
    `SELECT vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, visible
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  const planRows = await queryMany<Record<string, unknown>>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendorRow as unknown as Vendor, planRows as unknown as Plan[]);
  // El tope de solicitudes rige para servicios y estética (otros verticales
  // no usan quotes/bookings como canal de venta). El límite sale del plan
  // efectivo: servicio lee max_quotes_month de la fila; estética gratis usa
  // su tope propio (ESTETICA_FREE_QUOTES_MONTH en plans.ts).
  if ((vendorRow?.vertical as string) !== "servicio" && (vendorRow?.vertical as string) !== "estetica") {
    return { used: 0, limit: null, planSlug: plan.slug };
  }
  const limit = plan.maxQuotesMonth;

  if (limit == null) return { used: 0, limit: null, planSlug: plan.slug };

  const monthStart = `date_trunc('month', now())`;
  // Solo origin='portal' (online del cliente): los manuales del comercio no
  // cuentan. Si la columna origin aún no existe, cae al conteo legacy.
  const countWithOrigin = async (table: string): Promise<number> => {
    try {
      const row = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM ${table} WHERE vendor_id = $1 AND status <> 'cancelled' AND origin = 'portal' AND created_at >= ${monthStart}`,
        [vendorId]
      );
      return row?.c ?? 0;
    } catch {
      const row = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM ${table} WHERE vendor_id = $1 AND status <> 'cancelled' AND created_at >= ${monthStart}`,
        [vendorId]
      ).catch(() => ({ c: 0 }));
      return row?.c ?? 0;
    }
  };
  const [qc, bc] = await Promise.all([countWithOrigin("quotes"), countWithOrigin("bookings")]);
  return { used: qc + bc, limit, planSlug: plan.slug };
}

/** Error de negocio: tope mensual de solicitudes alcanzado. → 429 */
export class ServiceQuotaError extends Error {
  constructor(
    message = "Este profesional llegó al tope de solicitudes online del mes. Escribile por WhatsApp."
  ) {
    super(message);
    this.name = "ServiceQuotaError";
  }
}
