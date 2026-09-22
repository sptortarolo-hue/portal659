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
  // El tope de solicitudes solo rige para servicios (otros verticales no usan
  // quotes/bookings como canal de venta).
  if ((vendorRow?.vertical as string) !== "servicio") {
    return { used: 0, limit: null, planSlug: plan.slug };
  }
  const limit = plan.maxQuotesMonth;

  if (limit == null) return { used: 0, limit: null, planSlug: plan.slug };

  const monthStart = `date_trunc('month', now())`;
  const [q, b] = await Promise.all([
    queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM quotes WHERE vendor_id = $1 AND status <> 'cancelled' AND created_at >= ${monthStart}`,
      [vendorId]
    ).catch(() => ({ c: 0 })),
    queryOne<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM bookings WHERE vendor_id = $1 AND status <> 'cancelled' AND created_at >= ${monthStart}`,
      [vendorId]
    ).catch(() => ({ c: 0 })),
  ]);
  return { used: (q?.c ?? 0) + (b?.c ?? 0), limit, planSlug: plan.slug };
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
