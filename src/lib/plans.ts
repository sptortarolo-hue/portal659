import type {
  Plan,
  PlanFeatures,
  PlanSlug,
  PlanStatus,
  Vendor,
} from "@/types/database";

export const PLAN_IDS: Record<PlanSlug, string> = {
  gratuito: "6f000000-0000-4000-8000-000000000001",
  pedidos: "6f000000-0000-4000-8000-000000000002",
  gestion: "6f000000-0000-4000-8000-000000000003",
};

export const PLAN_SLUGS: PlanSlug[] = ["gratuito", "pedidos", "gestion"];

// Los planes pagos están disponibles solo para gastronomía por ahora.
export const PAID_PLAN_SLUGS: PlanSlug[] = ["pedidos", "gestion"];

export const GASTRO_VERTICAL = "gastronomia";

export function isGastroVendor(vendor: Pick<Vendor, "vertical">): boolean {
  return vendor.vertical === GASTRO_VERTICAL;
}

export type FeatureKey = keyof PlanFeatures;

const GRATUITO_FEATURES: PlanFeatures = {
  info: true,
  cart: false,
  emits_orders: false,
  mp_payments: false,
  kds: false,
  printer: false,
  variants: false,
  modifiers: false,
  urgent: false,
  pos: false,
  mesas: false,
  reviews_manage: false,
  analytics_days: 0,
  priority: false,
};

export function featureOf(plan: Plan | null | undefined, feature: FeatureKey): boolean {
  if (!plan) return false;
  const value = plan.features?.[feature];
  if (typeof value === "boolean") return value;
  return false;
}

export type EffectivePlan = {
  plan: Plan | null;
  slug: PlanSlug | "none";
  status: PlanStatus;
  trialActive: boolean;
  active: boolean;
  expired: boolean;
  eligibleForPaid: boolean;
  can: (feature: FeatureKey) => boolean;
  analyticsDays: number;
  maxProducts: number | null;
  hasTrial: boolean;
  trialEndsAt: string | null;
};

/**
 * Resuelve el plan efectivo del vendor a partir de la fila de vendors.
 * Deriva el estado actual (trial/active/expired) sin necesidad de cron:
 * - planners pagos: vigente mientras vence trial/periodo no haya pasado.
 * - si venció, cae a features de Gratuito (no rompe la app, bloquea lo pago).
 */
export function resolveVendorPlan(
  vendor: Pick<Vendor, "vertical" | "plan_id" | "plan_status" | "plan_expires_at" | "trial_ends_at">,
  plans: Plan[]
): EffectivePlan {
  const now = Date.now();
  const trialEndsAt = vendor.trial_ends_at ? new Date(vendor.trial_ends_at).getTime() : null;
  const planExpiresAt = vendor.plan_expires_at ? new Date(vendor.plan_expires_at).getTime() : null;

  const plan =
    plans.find((p) => p.id === vendor.plan_id) ||
    plans.find((p) => p.slug === "gratuito") ||
    null;

  const isPaid = plan ? plan.slug !== "gratuito" : false;

  const trialActive =
    isPaid &&
    vendor.plan_status === "trial" &&
    trialEndsAt !== null &&
    now < trialEndsAt + 24 * 60 * 60 * 1000;

  const active =
    isPaid &&
    (vendor.plan_status === "active" || vendor.plan_status === "trial") &&
    planExpiresAt !== null &&
    now < planExpiresAt;

  const pendingRenewal =
    isPaid && vendor.plan_status === "active" && planExpiresAt !== null && now >= planExpiresAt;

  const expired = !trialActive && !active && isPaid;

  const effectiveFeatures = trialActive || active ? plan : GRATUITO_FEATURES;

  let status: PlanStatus;
  if (!isPaid) status = "gratuito";
  else if (trialActive) status = "trial";
  else if (active) status = "active";
  else status = expired ? "expired" : "gratuito";

  // Los comercios no-gastronomía no pueden tener planes pagos por ahora:
  // si por admin quedaron con uno, se resuelve como gratuito igual.
  const eligibleForPaid = isGastroVendor(vendor);

  const can = (feature: FeatureKey): boolean => {
    if (!eligibleForPaid) return GRATUITO_FEATURES[feature] === true;
    return featureOf(
      trialActive || active ? plan : null,
      feature
    );
  };

  return {
    plan,
    slug: plan?.slug ?? "none",
    status,
    trialActive,
    active,
    expired,
    eligibleForPaid,
    can,
    analyticsDays: trialActive || active ? (plan?.features.analytics_days ?? 0) : 0,
    maxProducts: trialActive || active ? (plan?.max_products ?? null) : GRATUITO_FEATURES.info ? 3 : 3,
    hasTrial: trialEndsAt !== null && now < trialEndsAt,
    trialEndsAt: vendor.trial_ends_at,
  };
}

export function formatPrice(value: number | null): string {
  if (value == null) return "Ilimitado";
  if (value === 0) return "Gratis";
  return `$${Number(value).toLocaleString("es-AR")}/mes`;
}

export type PlanPromo = {
  price: number;
  listPrice: number;
  offPct: number;
  months: number;
  endsAt: string | null;
  label: string | null;
};

export function activePromo(plan: Plan): PlanPromo | null {
  const listPrice = Number(plan.price_monthly || 0);
  const price = Number(plan.promo_price || 0);
  const months = Number(plan.promo_months || 0);

  const hasPromo =
    listPrice > 0 &&
    price > 0 &&
    price < listPrice &&
    months > 0;

  if (!hasPromo) return null;

  const now = Date.now();
  if (plan.promo_ends_at && new Date(plan.promo_ends_at).getTime() <= now) return null;

  return {
    price,
    listPrice,
    offPct: Math.round((1 - price / listPrice) * 100),
    months,
    endsAt: plan.promo_ends_at,
    label: plan.promo_label,
  };
}

export function daysLeft(dateStr: string | null): number {
  if (!dateStr) return 0;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}