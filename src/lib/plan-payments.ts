import { queryOne, type Tx } from "@/lib/db";
import { planPriceFor, type PlanPrice } from "@/lib/plans";
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
    whatsapp: process.env.PORTAL_WHATSAPP || null,
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
 * Monto y período de una renovación. Mientras la promo esté vigente la pagan
 * TODOS (altas y renovaciones) con los mismos términos: N meses al precio
 * promo. Sin promo, 1 mes al precio de lista.
 */
export function computeRenewal(
  vendor: { plan_expires_at: string | null },
  plan: Plan
): {
  amount: number;
  periodStart: string;
  periodEnd: string;
  promoMonths: number;
  price: PlanPrice;
} {
  const base = renewalBase(vendor.plan_expires_at);
  const price = planPriceFor(plan) ?? {
    amount: Number(plan.price_monthly || 0),
    isPromo: false,
    listPrice: Number(plan.price_monthly || 0),
    offPct: null,
    months: 1,
    promoEndsAt: plan.promo_ends_at ?? null,
    promoLabel: plan.promo_label ?? null,
  };
  const months = price.months || 1;
  const periodEnd = new Date(base.getTime() + months * PERIOD_DAYS * 24 * 60 * 60 * 1000);
  return {
    amount: price.amount,
    periodStart: base.toISOString(),
    periodEnd: periodEnd.toISOString(),
    promoMonths: months,
    price,
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
