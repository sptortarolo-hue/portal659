import { queryOne } from "@/lib/db";
import { planPriceFor } from "@/lib/plans";
import type { Plan } from "@/types/database";
import type { Carrier } from "@/types/database";

/**
 * Planes de logística (Modelo B: suscripción mensual).
 *
 * Reutiliza la tabla `plans` con `target='carrier'` y los mismos campos
 * de plan que los vendors (`plan_id`, `plan_status`, `plan_expires_at`).
 * El circuito de pago (transferencia + aprobación admin) es el mismo
 * que el de comercios: `subscription_payments` con `carrier_id`.
 */

export type CarrierEffectivePlan = {
  plan: Plan | null;
  status: "gratuito" | "trial" | "active" | "expired" | "cancelled" | "past_due";
  expiresAt: string | null;
  trialEndsAt: string | null;
  /** Días de analytics incluidos (0 = sin analytics). */
  analyticsDays: number;
  /** Límite de envíos/mes (null = ilimitado). */
  maxShipmentsMonth: number | null;
  /** ¿El plan está vigente (incluye gracia past_due)? */
  active: boolean;
};

const FREE_CARRIER_SLUG = "carrier_gratuito";

/** Resuelve el plan efectivo de una logística. Tolerante a migración sin aplicar. */
export async function resolveCarrierPlan(carrierId: string): Promise<CarrierEffectivePlan> {
  const fallback: CarrierEffectivePlan = {
    plan: null,
    status: "gratuito",
    expiresAt: null,
    trialEndsAt: null,
    analyticsDays: 0,
    maxShipmentsMonth: 10,
    active: true,
  };
  try {
    const carrier = await queryOne<{
      plan_id: string | null;
      plan_status: string | null;
      plan_expires_at: string | null;
      trial_ends_at: string | null;
    }>(
      `SELECT plan_id, plan_status, plan_expires_at, trial_ends_at
       FROM carriers WHERE id = $1 LIMIT 1`,
      [carrierId]
    );
    if (!carrier) return fallback;

    const status = (carrier.plan_status || "gratuito") as CarrierEffectivePlan["status"];
    const expiresAt = carrier.plan_expires_at;
    const trialEndsAt = carrier.trial_ends_at;

    // Vigencia: activo o en gracia (past_due con reclamo pendiente).
    const now = Date.now();
    const exp = expiresAt ? new Date(expiresAt).getTime() : 0;
    const trial = trialEndsAt ? new Date(trialEndsAt).getTime() : 0;
    let active = false;
    if (status === "active" || status === "trial") {
      active = exp === 0 || exp > now || (status === "trial" && trial > now);
    } else if (status === "past_due") {
      active = true; // gracia mientras haya reclamo pendiente
    } else if (status === "gratuito") {
      active = true;
    }

    // Plan: si no hay plan_id, usar el gratuito.
    let plan: Plan | null = null;
    if (carrier.plan_id) {
      plan = (await queryOne<Plan>(`SELECT * FROM plans WHERE id = $1`, [carrier.plan_id])) ?? null;
    }
    if (!plan) {
      plan = (await queryOne<Plan>(`SELECT * FROM plans WHERE slug = $1 AND target = 'carrier' LIMIT 1`, [FREE_CARRIER_SLUG])) ?? null;
    }

    const features = (plan?.features || {}) as Record<string, unknown>;
    const analyticsDays = active && features.analytics === true ? Number((features as { analytics_days?: number }).analytics_days || 0) : 0;
    const maxShipments = plan?.max_quotes_month ?? (status === "gratuito" ? 10 : null);

    // Si venció, cae al gratuito.
    if (!active && status !== "gratuito") {
      const freePlan = (await queryOne<Plan>(`SELECT * FROM plans WHERE slug = $1 AND target = 'carrier' LIMIT 1`, [FREE_CARRIER_SLUG])) ?? null;
      return {
        plan: freePlan,
        status: "expired",
        expiresAt,
        trialEndsAt,
        analyticsDays: 0,
        maxShipmentsMonth: 10,
        active: true,
      };
    }

    return {
      plan,
      status,
      expiresAt,
      trialEndsAt,
      analyticsDays,
      maxShipmentsMonth: maxShipments,
      active,
    };
  } catch {
    return fallback;
  }
}

/** ¿Tiene plan activo (incluye gratuito)? */
export function isCarrierPlanActive(ep: CarrierEffectivePlan): boolean {
  return ep.active;
}

/** Días de analytics para la logística. */
export function carrierAnalyticsDays(ep: CarrierEffectivePlan): number {
  return ep.analyticsDays;
}
