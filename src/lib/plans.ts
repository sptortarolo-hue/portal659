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
  oficios: "6f000000-0000-4000-8000-000000000004",
};

export const PLAN_SLUGS: PlanSlug[] = ["gratuito", "pedidos", "gestion", "oficios"];

// Los planes pagos están disponibles para gastronomía, comercio de barrio,
// moda y servicios.
export const PAID_PLAN_SLUGS: PlanSlug[] = ["pedidos", "gestion", "oficios"];

export const GASTRO_VERTICAL = "gastronomia";
export const MODA_VERTICAL = "moda";
export const COMERCIO_VERTICAL = "comercio";
export const SERVICIO_VERTICAL = "servicio";

export function isGastroVendor(vendor: { vertical?: string | null }): boolean {
  return vendor.vertical === GASTRO_VERTICAL;
}

export function isModaVendor(vendor: { vertical?: string | null }): boolean {
  return vendor.vertical === MODA_VERTICAL;
}

export function isComercioVendor(vendor: { vertical?: string | null }): boolean {
  return vendor.vertical === COMERCIO_VERTICAL;
}

export function isServicioVendor(vendor: { vertical?: string | null }): boolean {
  return vendor.vertical === SERVICIO_VERTICAL;
}

/**
 * Verticales "retail": venden productos físicos (con stock) sin cocina.
 * Comparten el flow de pedido con aceptación explícita (estilo moda):
 * new → confirmed → preparing ("Empaquetando") → ready → sent → completed.
 */
export const RETAIL_VERTICALS: string[] = [MODA_VERTICAL, COMERCIO_VERTICAL];

export function isRetailVendor(vendor: { vertical?: string | null }): boolean {
  return !!vendor.vertical && RETAIL_VERTICALS.includes(vendor.vertical);
}

export type FeatureKey = keyof PlanFeatures;

// Features de los comercios SIN plan pago (no-gastro, servicios): solo contacto.
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
  recipes: false,
  crm: false,
  quotes_respond: false,
  deposits: false,
};

// Features del plan Gratuito para gastronomía: carta completa + carrito +
// pedidos por la app, con tope mensual de pedidos (max_orders_month).
// También es el fallback de un plan pago vencido (sigue tomando pedidos con tope).
const FREE_GASTRO_FEATURES: PlanFeatures = {
  ...GRATUITO_FEATURES,
  cart: true,
  emits_orders: true,
};

// Moda (indumentaria) vende con carrito + pedidos desde el micrositio.
// Gratis: carrito con tope propio de 5 pedidos/mes (MODA_FREE_ORDERS_MONTH,
// NO la fila "gratuito": esos 20 son de gastro/comercio). Con plan pago
// vigente (Pedidos/Gestión, mismos precios que gastro) suma lo del plan con
// mask de vertical (sin kds/mesas/recipes). Variantes, guía de talles y
// fotos por color no están gateadas (son el producto mismo).
const MODA_FEATURES: PlanFeatures = {
  ...GRATUITO_FEATURES,
  cart: true,
  emits_orders: true,
};

/** Tope mensual de pedidos online del plan gratuito de moda (propio, no el de gastro). */
export const MODA_FREE_ORDERS_MONTH = 5;

// Comercio de barrio (retail: almacén, kiosco, ferretería, librería...):
// venta online con retiro/delivery + mostrador. Usa los MISMOS planes pagos
// que gastronomía, pero NUNCA las features de cocina/salón aunque el plan
// gestión las traiga en su JSONB (kds/mesas/recipes quedan enmascaradas).
const COMERCIO_FREE_FEATURES: PlanFeatures = {
  ...GRATUITO_FEATURES,
  cart: true,
  emits_orders: true,
};

// Servicios (plomero, electricista...): vidriera + contacto + solicitudes
// (presupuestos/turnos) con tope mensual. El plan Oficios suma gestión.
// Recibir solicitudes no es feature gateada (es el gratuito mismo); el tope
// vive en plans.max_quotes_month.
const SERVICIO_FREE_FEATURES: PlanFeatures = {
  ...GRATUITO_FEATURES,
};

// Features que no aplican al vertical servicios (forzadas a false aunque el
// JSONB del plan las traiga: un plomero no tiene cocina, salón ni POS).
const SERVICIO_FEATURE_MASK: Partial<Record<FeatureKey, false>> = {
  cart: false,
  emits_orders: false,
  kds: false,
  mesas: false,
  pos: false,
  variants: false,
  modifiers: false,
  recipes: false,
};

// Features del plan que no aplican al vertical moda (forzadas a false).
// pos/printer/caja/crm/analytics/reviews/mp SÍ aplican con el plan pago
// (Mostrador con variantes + Caja + Clientes + impresión de ticket).
const MODA_FEATURE_MASK: Partial<Record<FeatureKey, false>> = {
  kds: false,
  mesas: false,
  recipes: false,
};

// Features del plan que no aplican al vertical comercio (forzadas a false).
// pos/printer/caja/crm/analytics/reviews SÍ aplican con el plan pago.
const COMERCIO_FEATURE_MASK: Partial<Record<FeatureKey, false>> = {
  kds: false,
  mesas: false,
  recipes: false,
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
  maxOrdersMonth: number | null;
  /** Tope mensual combinado de presupuestos + turnos (servicios). NULL = ilimitado. */
  maxQuotesMonth: number | null;
  hasTrial: boolean;
  trialEndsAt: string | null;
};

/**
 * Resuelve el plan efectivo del vendor a partir de la fila de vendors.
 * Deriva el estado actual (trial/active/expired) sin necesidad de cron:
 * - planners pagos: vigente mientras vence trial/periodo no haya pasado.
 * - si venció, cae a features de Gratuito (no rompe la app, bloquea lo pago).
 * - preview (visible === false): todo habilitado e ilimitado, sin conteo de
 *   uso. Al publicar toma el control el plan real (el reloj arranca ahí).
 */
export function resolveVendorPlan(
  vendor: Pick<Vendor, "vertical" | "plan_id" | "plan_status" | "plan_expires_at" | "trial_ends_at" | "visible">,
  plans: Plan[]
): EffectivePlan {
  const now = Date.now();

  const plan =
    plans.find((p) => p.id === vendor.plan_id) ||
    plans.find((p) => p.slug === "gratuito") ||
    null;

  if (vendor.visible === false) {
    return {
      plan,
      slug: plan?.slug ?? "none",
      status: "preview",
      trialActive: false,
      active: false,
      expired: false,
      eligibleForPaid: isGastroVendor(vendor) || isComercioVendor(vendor) || isServicioVendor(vendor) || isModaVendor(vendor),
      can: () => true,
      analyticsDays: 99999,
      maxProducts: null,
      maxOrdersMonth: null,
      maxQuotesMonth: null,
      hasTrial: false,
      trialEndsAt: vendor.trial_ends_at,
    };
  }

  const trialEndsAt = vendor.trial_ends_at ? new Date(vendor.trial_ends_at).getTime() : null;
  const planExpiresAt = vendor.plan_expires_at ? new Date(vendor.plan_expires_at).getTime() : null;

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

  let status: PlanStatus;
  if (!isPaid) status = "gratuito";
  else if (trialActive) status = "trial";
  else if (active) status = "active";
  else status = expired ? "expired" : "gratuito";

  // Gastro, comercio, moda y servicios pueden tener planes pagos; el resto de
  // los verticales resuelven siempre como gratuito.
  const eligibleForPaid = isGastroVendor(vendor) || isComercioVendor(vendor) || isServicioVendor(vendor) || isModaVendor(vendor);

  const can = (feature: FeatureKey): boolean => {
    if (isModaVendor(vendor)) {
      // Mask del vertical: gestión trae kds/mesas/recipes en su JSONB, pero
      // un local de ropa nunca los usa (no tiene cocina ni salón).
      if (MODA_FEATURE_MASK[feature] === false) return false;
      if (trialActive || active) return featureOf(plan, feature);
      return MODA_FEATURES[feature] === true;
    }
    if (isComercioVendor(vendor)) {
      // Mask del vertical: gestión trae kds/mesas/recipes en su JSONB, pero
      // un comercio nunca las usa (no tiene cocina ni salón).
      if (COMERCIO_FEATURE_MASK[feature] === false) return false;
      if (trialActive || active) return featureOf(plan, feature);
      return COMERCIO_FREE_FEATURES[feature] === true;
    }
    if (isServicioVendor(vendor)) {
      // Mask del vertical: sin cocina, salón, POS ni carrito (solo contacto).
      if (SERVICIO_FEATURE_MASK[feature] === false) return false;
      if (trialActive || active) return featureOf(plan, feature);
      return SERVICIO_FREE_FEATURES[feature] === true;
    }
    if (!eligibleForPaid) return GRATUITO_FEATURES[feature] === true;
    if (trialActive || active) return featureOf(plan, feature);
    return FREE_GASTRO_FEATURES[feature] === true;
  };

  // Límites (productos y pedidos/mes): para el plan pago vigente se leen del
  // plan; en cualquier otro caso (gratuito o pago vencido) se leen del plan
  // "gratuito" para que el admin pueda configurar el tope sin tocar código.
  // Excepción: moda gratis/vencido usa su tope propio (5, no los 20 de gastro).
  const freePlanRow = plans.find((p) => p.slug === "gratuito") ?? null;
  const limitRow = trialActive || active ? plan : freePlanRow;
  const maxOrdersMonth =
    isModaVendor(vendor) && !(trialActive || active)
      ? MODA_FREE_ORDERS_MONTH
      : (limitRow?.max_orders_month ?? null);

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
    maxProducts: limitRow?.max_products ?? null,
    maxOrdersMonth,
    maxQuotesMonth: limitRow?.max_quotes_month ?? null,
    hasTrial: trialEndsAt !== null && now < trialEndsAt,
    trialEndsAt: vendor.trial_ends_at,
  };
}

/**
 * ¿El comercio vende por la app (carrito + pedidos)? Plan con carrito Y
 * opt-in del comercio (accepts_online_orders !== false; default true para
 * compatibilidad con filas previas a la migración).
 * A prueba de futuros cambios de features por vertical: hoy equivale a
 * gastro/moda con el toggle prendido, pero no se hardcodea el vertical.
 */
export function vendorSellsOnline(
  vendor: {
    vertical: string | null;
    plan_id: string | null;
    plan_status: string | null;
    plan_expires_at: string | null;
    trial_ends_at: string | null;
    accepts_online_orders?: boolean | null;
  },
  plans: Plan[]
): boolean {
  if (vendor.accepts_online_orders === false) return false;
  return resolveVendorPlan(
    vendor as Pick<Vendor, "vertical" | "plan_id" | "plan_status" | "plan_expires_at" | "trial_ends_at">,
    plans
  ).can("cart");
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