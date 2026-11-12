/**
 * Paso a paso de arranque de un comercio (onboarding).
 *
 * Deriva TODO de datos que el dashboard ya tiene (vendor + contadores), sin
 * fetches nuevos y sin migraciones: es la misma filosofía que
 * `configSectionStatus` en config-nav.ts.
 *
 * Lo consumen:
 *  - `VendorSetupWizard` (alta de un comercio nuevo / completar uno recién creado)
 *  - `SetupProgressCard` (tarjeta "Cómo va tu comercio" en el tab Hoy)
 */

/** Ventana de "comercio nuevo": pasado este plazo no se muestra nada
 *  (los que ya están operativos no ven ni wizard ni tarjeta). */
export const SETUP_NEW_DAYS = 14;

export type SetupKind = "venta" | "hibrido" | "servicio";

/** Vertical → tipo de arranque. híbridos = estética/salud/taller (turnera + venta). */
export function setupKind(vertical: string | null | undefined): SetupKind {
  if (vertical === "estetica" || vertical === "salud" || vertical === "taller") return "hibrido";
  if (vertical === "servicio") return "servicio";
  return "venta";
}

/** Sustantivo del catálogo según el vertical (copy del panel). */
export function catalogNoun(vertical: string | null | undefined): string {
  switch (vertical) {
    case "gastronomia":
      return "plato";
    case "servicio":
    case "estetica":
    case "salud":
    case "taller":
      return "servicio";
    default:
      return "producto";
  }
}

/** Campos del vendor que necesita el chequeo (subset tipado laxo a propósito:
 *  el wizard corre también con vendor recién creado, donde pueden faltar). */
export type SetupVendorLike = {
  store_name?: string | null;
  category?: string | null;
  description?: string | null;
  image_url?: string | null;
  logo_url?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  hours?: string | null;
  whatsapp?: string | null;
  payment_methods?: string | null;
  mp_user_id?: number | null;
  stripe_account_id?: string | null;
  services_list?: string | null;
  visibility?: string | null;
  publish_requested_at?: string | null;
  vertical?: string | null;
  created_at?: string | null;
} | null | undefined;

export type SetupTarget =
  | { kind: "config"; section: string }
  | { kind: "tab"; tab: string };

export type SetupCheck = {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  /** Los opcionales no bloquean el "listo" y se marcan en otro color. */
  optional?: boolean;
  target: SetupTarget;
};

export type SetupCounts = {
  /** Productos cargados (venta). */
  offers?: number;
  /** Servicios cargados (estética/taller: tabla `services`). */
  services?: number;
};

const has = (v: unknown): boolean =>
  typeof v === "string" ? v.trim().length > 0 : v != null && v !== "";

/** Comercio dentro de la ventana de "nuevo" (ve wizard/tarjeta). */
export function isNewVendor(vendor: SetupVendorLike): boolean {
  if (!vendor?.created_at) return true;
  const t = new Date(vendor.created_at).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t <= SETUP_NEW_DAYS * 86400000;
}

/**
 * Checks de arranque, en orden de la secuencia canónica (la del manual
 * `/manuales/basico`): perfil → ubicación → contacto → operación → catálogo
 * → publicación. El orden es también el de los pasos del wizard.
 */
export function setupChecks(
  vendor: SetupVendorLike,
  counts: SetupCounts = {},
  kind: SetupKind = "venta"
): SetupCheck[] {
  const noun = catalogNoun(vendor?.vertical);
  const catalogoDone =
    kind === "venta"
      ? (counts.offers ?? 0) > 0
      : (counts.services ?? 0) > 0 || has(vendor?.services_list);
  const catalogoTarget: SetupTarget =
    kind === "hibrido"
      ? { kind: "tab", tab: "servicios" }
      : kind === "servicio"
        ? { kind: "config", section: "servicios" }
        : { kind: "tab", tab: "menu" };

  const checks: SetupCheck[] = [
    {
      id: "perfil",
      label: "Nombre y rubro",
      hint: "Es lo primero que leen tus vecinos.",
      done: has(vendor?.store_name) && has(vendor?.category),
      target: { kind: "config", section: "perfil" },
    },
    {
      id: "fotos",
      label: "Foto y logo",
      hint: "Con foto la vidriera convoca el doble.",
      done: has(vendor?.image_url) || has(vendor?.logo_url),
      target: { kind: "config", section: "perfil" },
    },
    {
      id: "descripcion",
      label: "Descripción",
      hint: "Contá en 2 líneas qué vendés o qué hacés.",
      done: (vendor?.description || "").trim().length >= 15,
      target: { kind: "config", section: "perfil" },
    },
    {
      id: "ubicacion",
      label: "Dirección en el mapa",
      hint: "Para que aparezcas en el mapa del barrio.",
      done: has(vendor?.address) && vendor?.lat != null && vendor?.lng != null,
      target: { kind: "config", section: "ubicacion" },
    },
    {
      id: "horarios",
      label: "Horarios de atención",
      hint: "Y el cartel de Abierto/Cerrado se calcula solo.",
      done: has(vendor?.hours),
      target: { kind: "config", section: "ubicacion" },
    },
    {
      id: "whatsapp",
      label: "WhatsApp",
      hint: "El canal directo con tus clientes.",
      done: has(vendor?.whatsapp),
      target: { kind: "config", section: "contacto" },
    },
    {
      id: "pagos",
      label: "Medios de pago",
      hint: "Qué aceptás: efectivo, tarjeta, transferencia…",
      done: has(vendor?.payment_methods),
      target: { kind: "config", section: "pagos" },
    },
    {
      id: "catalogo",
      label: `Tu primer ${noun}`,
      hint:
        kind === "venta"
          ? "Con algo cargado, la vidriera ya se puede difundir."
          : "Es lo que van a poder reservar o pedir.",
      done: catalogoDone,
      target: catalogoTarget,
    },
    {
      id: "cobros_online",
      label: "Cobrar online (Mercado Pago)",
      hint: "Opcional: podés arrancar solo con WhatsApp.",
      done: has(vendor?.mp_user_id) || has(vendor?.stripe_account_id),
      optional: true,
      target: { kind: "config", section: "pagos" },
    },
    {
      id: "publicar",
      label: "Publicar tu comercio",
      hint: "Lo revisamos y aparece en el portal para todos.",
      done: vendor?.visibility === "public" || has(vendor?.publish_requested_at),
      optional: true,
      target: { kind: "tab", tab: "hoy" },
    },
  ];

  // Servicios simples (oficios) no tienen "medios de pago" como paso propio:
  // la config es Servicios + Urgencia.
  if (kind === "servicio") {
    return checks.filter((c) => c.id !== "pagos");
  }
  return checks;
}

export type SetupProgressInfo = { done: number; total: number; pct: number; pending: SetupCheck[] };

/** Progreso = obligatorios completos (los opcionales no bajan el %). */
export function setupProgress(checks: SetupCheck[]): SetupProgressInfo {
  const required = checks.filter((c) => !c.optional);
  const done = required.filter((c) => c.done).length;
  return {
    done,
    total: required.length,
    pct: required.length ? Math.round((done / required.length) * 100) : 100,
    pending: checks.filter((c) => !c.done),
  };
}

// --- Pasos del wizard (misma secuencia que los checks de arriba) ---

export type WizardStepId =
  | "negocio"
  | "ubicacion"
  | "contacto"
  | "fotos"
  | "operacion"
  | "catalogo"
  | "listo";

export type WizardStep = {
  id: WizardStepId;
  title: string;
  desc: string;
  emoji: string;
  /** Se puede saltear sin romper el alta. */
  optional: boolean;
};

export function wizardSteps(kind: SetupKind): WizardStep[] {
  const catalogo: Record<SetupKind, { title: string; desc: string }> = {
    venta: { title: "Tu catálogo", desc: "Cargá tu primer producto para abrir la vidriera." },
    hibrido: { title: "Tus servicios", desc: "Definí qué ofrecés y con qué agenda." },
    servicio: { title: "Tus servicios", desc: "Contá qué hacés y a dónde llegás." },
  };
  const operacion: Record<SetupKind, { title: string; desc: string }> = {
    venta: { title: "Pagos y entrega", desc: "Cómo te pagan y cómo entregás." },
    hibrido: { title: "Turnos y presupuestos", desc: "Recibí reservas y cotizaciones online." },
    servicio: { title: "Turnos y presupuestos", desc: "Recibí consultas y pedidos de turno." },
  };
  return [
    { id: "negocio", title: "Tu negocio", desc: "Rubro, nombre y qué vendés.", emoji: "🏪", optional: false },
    { id: "ubicacion", title: "Dónde estás", desc: "Dirección en el mapa y horarios.", emoji: "📍", optional: true },
    { id: "contacto", title: "Contacto", desc: "El WhatsApp de tu comercio.", emoji: "📱", optional: true },
    { id: "fotos", title: "Fotos", desc: "Portada y logo de tu vidriera.", emoji: "📸", optional: true },
    { id: "operacion", ...operacion[kind], emoji: kind === "venta" ? "💳" : "🗓️", optional: true },
    { id: "catalogo", ...catalogo[kind], emoji: kind === "venta" ? "📦" : "🧰", optional: true },
    { id: "listo", title: "¡Listo!", desc: "Revisá tu vidriera y publicá.", emoji: "🎉", optional: true },
  ];
}
