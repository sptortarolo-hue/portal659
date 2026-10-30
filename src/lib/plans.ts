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
// moda, servicios y estética.
export const PAID_PLAN_SLUGS: PlanSlug[] = ["pedidos", "gestion", "oficios"];

export const GASTRO_VERTICAL = "gastronomia";
export const MODA_VERTICAL = "moda";
export const COMERCIO_VERTICAL = "comercio";
export const SERVICIO_VERTICAL = "servicio";
export const ESTETICA_VERTICAL = "estetica";

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

export function isEsteticaVendor(vendor: { vertical?: string | null }): boolean {
  return vendor.vertical === ESTETICA_VERTICAL;
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
  fiscal: false,
  inventory: false,
  // Pantalla TV: 1 pantalla gratis para los comercios con carta (growth).
  // Servicios la enmascara a false (no tiene carta de menú).
  screens: true,
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

// Estética (peluquería, barbería, uñas, pestañas, cejas, masajes...): híbrido
// turnera + productos. 3 planes: Gratuito (5 solicitudes/mes con tope propio,
// ESTETICA_FREE_QUOTES_MONTH, NO los 5 de servicio — y 5 pedidos con
// ESTETICA_FREE_ORDERS_MONTH), "Turnera" (fila `pedidos`: turnera + pedidos
// ilimitados) y "Gestión integral" (todo el POS/Caja/Clientes impresión).
// NO se vende Oficios a estética (solo servicios); con plan pago vigente la
// turnera completa (cotizar con precio + seña MP) es override de código.
const ESTETICA_FREE_FEATURES: PlanFeatures = {
  ...GRATUITO_FEATURES,
  cart: true,
  emits_orders: true,
};

/** Tope mensual de solicitudes (turnos + presupuestos) gratis de estética. */
export const ESTETICA_FREE_QUOTES_MONTH = 5;

/** Tope mensual de pedidos online gratis de estética (venta de productos). */
export const ESTETICA_FREE_ORDERS_MONTH = 5;

// Servicios (plomero, electricista...): vidriera + contacto + solicitudes
// (presupuestos/turnos) con tope mensual. El plan Oficios suma gestión.
// Recibir solicitudes no es feature gateada (es el gratuito mismo); el tope
// vive en plans.max_quotes_month.
const SERVICIO_FREE_FEATURES: PlanFeatures = {
  ...GRATUITO_FEATURES,
};

// Features del plan que no aplican al vertical estética (forzadas a false).
// pos/printer/caja/crm/analytics/reviews/mp/cart SÍ aplican con o sin plan
// pago (el centro vende productos con el mismo circuito retail que moda).
// urgent tampoco: la urgencia 24h es concepto de oficios, no de turnera.
const ESTETICA_FEATURE_MASK: Partial<Record<FeatureKey, false>> = {
  kds: false,
  mesas: false,
  recipes: false,
  urgent: false,
};

// Features que no aplican al vertical servicios (forzadas a false aunque el
// JSONB del plan las traiga: un plomero no tiene cocina, salón ni POS).
// fiscal tampoco en v1 (sin circuito de cobro de pedidos).
const SERVICIO_FEATURE_MASK: Partial<Record<FeatureKey, false>> = {
  cart: false,
  emits_orders: false,
  kds: false,
  mesas: false,
  pos: false,
  variants: false,
  modifiers: false,
  recipes: false,
  fiscal: false,
  // Un servicio (plomero/electricista) no tiene carta de menú: la Pantalla
  // TV es de comercios que venden con carta (gastro/comercio/moda/estética).
  screens: false,
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
  /** Gracia por pago en revisión (plan_status='past_due'): features pagas vigentes. */
  grace: boolean;
  eligibleForPaid: boolean;
  can: (feature: FeatureKey) => boolean;
  analyticsDays: number;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
  /** Tope mensual combinado de presupuestos + turnos (servicios). NULL = ilimitado. */
  maxQuotesMonth: number | null;
  /** Cantidad máxima de pantallas TV del comercio (planes con feature `screens`). 0 = sin TV. */
  maxScreens: number | null;
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
      grace: false,
      eligibleForPaid: isGastroVendor(vendor) || isComercioVendor(vendor) || isServicioVendor(vendor) || isModaVendor(vendor) || isEsteticaVendor(vendor),
      can: () => true,
      analyticsDays: 99999,
      maxProducts: null,
      maxOrdersMonth: null,
      maxQuotesMonth: null,
      maxScreens: null,
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

  // Gracia por pago en revisión: el comercio subió el comprobante de la
  // renovación y el admin todavía no lo corroboró. El plan NO corta las
  // features pagas hasta que se apruebe o rechace (migrate-plan-payments.sql).
  const grace = isPaid && vendor.plan_status === "past_due";

  // Features pagas vigentes: plan al día o en gracia.
  const paid = trialActive || active || grace;

  const expired = !paid && isPaid;

  let status: PlanStatus;
  if (!isPaid) status = "gratuito";
  else if (trialActive) status = "trial";
  else if (active) status = "active";
  else if (grace) status = "past_due";
  else status = expired ? "expired" : "gratuito";

  // Gastro, comercio, moda, servicios y estética pueden tener planes pagos;
  // el resto de los verticales resuelven siempre como gratuito.
  const eligibleForPaid = isGastroVendor(vendor) || isComercioVendor(vendor) || isServicioVendor(vendor) || isModaVendor(vendor) || isEsteticaVendor(vendor);

  const can = (feature: FeatureKey): boolean => {
    if (isModaVendor(vendor)) {
      // Mask del vertical: gestión trae kds/mesas/recipes en su JSONB, pero
      // un local de ropa nunca los usa (no tiene cocina ni salón).
      if (MODA_FEATURE_MASK[feature] === false) return false;
      if (paid) return featureOf(plan, feature);
      return MODA_FEATURES[feature] === true;
    }
    if (isComercioVendor(vendor)) {
      // Mask del vertical: gestión trae kds/mesas/recipes en su JSONB, pero
      // un comercio nunca las usa (no tiene cocina ni salón).
      if (COMERCIO_FEATURE_MASK[feature] === false) return false;
      if (paid) return featureOf(plan, feature);
      return COMERCIO_FREE_FEATURES[feature] === true;
    }
    if (isServicioVendor(vendor)) {
      // Mask del vertical: sin cocina, salón, POS ni carrito (solo contacto).
      if (SERVICIO_FEATURE_MASK[feature] === false) return false;
      if (paid) return featureOf(plan, feature);
      return SERVICIO_FREE_FEATURES[feature] === true;
    }
    if (isEsteticaVendor(vendor)) {
      // Mask del vertical: gestión trae kds/mesas/recipes en su JSONB, pero
      // un centro de estética nunca los usa.
      if (ESTETICA_FEATURE_MASK[feature] === false) return false;
      if (paid) {
        // La turnera completa (cotizar con precio + seña MP) es parte de la
        // propuesta de los planes pagos de estética ("Turnera" usa la fila
        // `pedidos`, cuyo JSONB no las trae: se resuelven por override).
        if (feature === "quotes_respond" || feature === "deposits") return true;
        return featureOf(plan, feature);
      }
      return ESTETICA_FREE_FEATURES[feature] === true;
    }
    if (!eligibleForPaid) return GRATUITO_FEATURES[feature] === true;
    if (paid) return featureOf(plan, feature);
    return FREE_GASTRO_FEATURES[feature] === true;
  };

  // Límites (productos y pedidos/mes): para el plan pago vigente se leen del
  // plan; en cualquier otro caso (gratuito o pago vencido) se leen del plan
  // "gratuito" para que el admin pueda configurar el tope sin tocar código.
  // Excepciones con tope propio: moda gratis/vencido usa el suyo (5 pedidos,
  // no los 20 de gastro); estética gratis/vencido usa los suyos (5
  // solicitudes + 5 pedidos).
  const freePlanRow = plans.find((p) => p.slug === "gratuito") ?? null;
  const limitRow = paid ? plan : freePlanRow;
  const maxOrdersMonth =
    isModaVendor(vendor) && !(paid)
      ? MODA_FREE_ORDERS_MONTH
      : isEsteticaVendor(vendor) && !(paid)
        ? ESTETICA_FREE_ORDERS_MONTH
        : (limitRow?.max_orders_month ?? null);
  const maxQuotesMonth =
    isEsteticaVendor(vendor) && !(paid)
      ? ESTETICA_FREE_QUOTES_MONTH
      : (limitRow?.max_quotes_month ?? null);
  // Pantallas TV: el gratuito tiene 1 (growth), la gestión 2. Servicios y los
  // planes vencidos no tienen (0). El tope viene del plan (max_screens).
  const fallbackScreens = paid
    ? (plan?.slug === "gestion" ? 2 : 1)
    : 1;
  const maxScreens = can("screens")
    ? Number((paid ? plan : freePlanRow)?.max_screens ?? fallbackScreens)
    : 0;

  return {
    plan,
    slug: plan?.slug ?? "none",
    status,
    trialActive,
    active,
    expired,
    grace,
    eligibleForPaid,
    can,
    analyticsDays: paid ? (plan?.features.analytics_days ?? 0) : 0,
    maxProducts: limitRow?.max_products ?? null,
    maxOrdersMonth,
    maxQuotesMonth,
    maxScreens,
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

/**
 * Precio del día de un plan: ÚNICA fuente de verdad.
 *
 * Mientras la promo esté vigente (precio < lista, meses > 0 y
 * `promo_ends_at` no pasado), la pagan TODOS: altas nuevas y renovaciones,
 * con los mismos términos (N meses al precio promo). Si no, precio de lista.
 *
 * Lo consumen el panel del comercio, los avisos por mail, el circuito de
 * renovación (`renew`), el pago por Mercado Pago (`pay`), el cron de avisos
 * y el modal de emisión manual del admin, para que el monto que se cobra,
 * el que se muestra y el que se avisa sean siempre el mismo.
 */
export type PlanPrice = {
  /** Monto a cobrar hoy. */
  amount: number;
  /** ¿El monto sale de la promo? */
  isPromo: boolean;
  listPrice: number;
  /** Descuento real (null si no es promo o el precio de lista no es mayor). */
  offPct: number | null;
  /** Meses que cubre el pago (los de la promo, o 1 si es lista). */
  months: number;
  promoEndsAt: string | null;
  promoLabel: string | null;
};

export function planPriceFor(plan: Plan | null | undefined, at: Date = new Date()): PlanPrice | null {
  if (!plan) return null;
  const listPrice = Number(plan.price_monthly || 0);
  const atList: PlanPrice = {
    amount: listPrice,
    isPromo: false,
    listPrice,
    offPct: null,
    months: 1,
    promoEndsAt: plan.promo_ends_at ?? null,
    promoLabel: plan.promo_label ?? null,
  };

  const promo = activePromo(plan);
  if (!promo) return atList;
  // `activePromo` valida contra "ahora"; con fecha inyectada se revalida el fin.
  if (promo.endsAt && new Date(promo.endsAt).getTime() <= at.getTime()) return atList;

  return {
    amount: promo.price,
    isPromo: true,
    listPrice: promo.listPrice,
    offPct: promo.offPct,
    months: promo.months,
    promoEndsAt: promo.endsAt,
    promoLabel: promo.label,
  };
}

/**
 * Texto que explica el precio cobrado, para mails, panel y recibo:
 * "precio promo −25% (lista $20.000)" o "precio de lista".
 */
export function planPriceNote(price: PlanPrice | null): string | null {
  if (!price || price.amount <= 0) return null;
  if (price.isPromo && price.offPct) {
    return `precio promo −${price.offPct}% (lista ${formatPrice(price.listPrice)})`;
  }
  return "precio de lista";
}

export function daysLeft(dateStr: string | null): number {
  if (!dateStr) return 0;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}