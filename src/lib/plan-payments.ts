import { queryOne, type Tx } from "@/lib/db";
import { activePromo } from "@/lib/plans";
import type { Plan, PortalBank } from "@/types/database";

const PERIOD_DAYS = 30;

/** Datos de cobro del portal: fila `portal_bank` con fallback a env. */
export async function getPortalBank(): Promise<PortalBank> {
  try {
    const row = await queryOne<PortalBank>(`SELECT * FROM portal_bank WHERE id = 1`);
    if (row && (row.alias || row.cbu || row.qr_url)) return row;
  } catch {
    /* sin migrar: cae al fallback de env */
  }
  return {
    id: 1,
    alias: process.env.PORTAL_TRANSFER_ALIAS || null,
    cbu: process.env.PORTAL_TRANSFER_CBU || null,
    titular: process.env.PORTAL_TRANSFER_TITULAR || null,
    qr_url: process.env.PORTAL_TRANSFER_QR_URL || null,
    notes: null,
    updated_at: null,
  };
}

/** Base del nuevo período: nunca antes de ahora ni del vencimiento actual. */
export function renewalBase(planExpiresAt: string | null): Date {
  const exp = planExpiresAt ? new Date(planExpiresAt).getTime() : 0;
  return new Date(Math.max(Date.now(), exp));
}

/**
 * Monto y período de una renovación. Replica la lógica de
 * POST /api/subscriptions/pay: promo solo para suscriptores nuevos (plan
 * vigente o en prueba), si no 1 mes al precio de lista.
 */
export function computeRenewal(
  vendor: { plan_status: string | null; plan_expires_at: string | null; trial_ends_at: string | null },
  plan: Plan
): { amount: number; periodStart: string; periodEnd: string; promoMonths: number } {
  const base = renewalBase(vendor.plan_expires_at);
  const now = Date.now();
  const covered =
    (vendor.plan_status === "trial" &&
      vendor.trial_ends_at &&
      new Date(vendor.trial_ends_at).getTime() > now) ||
    (vendor.plan_status === "active" &&
      vendor.plan_expires_at &&
      new Date(vendor.plan_expires_at).getTime() > now);
  const promo = covered ? null : activePromo(plan);
  const months = promo ? promo.months : 1;
  const amount = promo ? promo.price * promo.months : Number(plan.price_monthly);
  const periodEnd = new Date(base.getTime() + months * PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return {
    amount,
    periodStart: base.toISOString(),
    periodEnd: periodEnd.toISOString(),
    promoMonths: months,
  };
}

/** Referencia del pago (mismo formato que la rama MP: reconocible). */
export function buildReference(vendorId: string, planSlug: string, periodStart: string): string {
  return `portal659_sub_${vendorId}_${planSlug}_${Math.floor(new Date(periodStart).getTime() / 1000)}`;
}

/**
 * Próximo número de recibo del año (global). Se llama DENTRO de la transacción
 * de aprobación: si dos aprobaciones corren en paralelo, el índice único
 * (year, seq) aborta la tx y el admin reintenta (caso raro: un solo admin).
 */
export async function nextReceiptSeq(
  tx: Pick<Tx, "query">,
  year = new Date().getFullYear()
): Promise<number> {
  const row = await tx.query<{ next: number }>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM plan_receipts WHERE year = $1`,
    [year]
  );
  return row?.[0]?.next ?? 1;
}
