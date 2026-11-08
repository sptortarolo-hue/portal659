/**
 * Órdenes de servicio (recepción de taller): una rama de `bookings` sin hora
 * ni duración, con fecha de ingreso + fecha de entrega estimada. Los estados
 * del flujo se pueden SALTEAR (el comercio avanza a donde corresponde con un
 * toque): recibida → diagnosticada → presupuestada → aprobada → en reparación
 * → lista → entregada.
 */

/** Estados de una orden (los turnos usan pending/confirmed/cancelled/noshow/completed). */
export const WORK_ORDER_STATES = [
  "pending",
  "diagnosed",
  "quoted",
  "approved",
  "repairing",
  "waiting_parts",
  "ready",
  "completed",
  "cancelled",
] as const;

export type WorkOrderState = (typeof WORK_ORDER_STATES)[number];

/** Orden del flujo productivo (sin contar recibida ni descartada). */
export const WORK_ORDER_FLOW = ["pending", "diagnosed", "quoted", "approved", "repairing", "waiting_parts", "ready", "completed"] as const;

const LABELS: Record<WorkOrderState, string> = {
  pending: "Recibida",
  diagnosed: "Diagnosticada",
  quoted: "Presupuestada",
  approved: "Aprobada",
  repairing: "En reparación",
  waiting_parts: "Esperando repuesto",
  ready: "Lista",
  completed: "Entregada",
  cancelled: "Descartada",
};

/** Tono visual por estado (mismo criterio que statusTone de agenda.ts). */
const TONES: Record<WorkOrderState, string> = {
  pending: "bg-amber-100 text-amber-700",
  diagnosed: "bg-sky-100 text-sky-700",
  quoted: "bg-violet-100 text-violet-700",
  approved: "bg-emerald-100 text-emerald-700",
  repairing: "bg-blue-100 text-blue-700",
  waiting_parts: "bg-orange-100 text-orange-700",
  ready: "bg-green-100 text-green-700",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-red-100 text-red-700",
};

export function workOrderStateLabel(status: unknown): string {
  const s = String(status || "pending");
  return LABELS[s as WorkOrderState] || s;
}

export function workOrderStateTone(status: unknown): string {
  const s = String(status || "pending");
  return TONES[s as WorkOrderState] || "bg-muted text-muted-foreground";
}

export function isWorkOrderState(status: unknown): boolean {
  return WORK_ORDER_STATES.includes(String(status) as WorkOrderState);
}

/** Estados terminales (no ofrecen avance). */
export function isTerminalState(status: unknown): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * Columnas del job board "🛠️ Taller": Recibida → Diagnosticada →
 * Presupuestada → Aprobada → En reparación → Esperando repuesto → Lista.
 * (Entregada/Descartada no forman columna: se ven en el historial.)
 */
export const WORK_ORDER_BOARD_COLUMNS = [
  "pending",
  "diagnosed",
  "quoted",
  "approved",
  "repairing",
  "waiting_parts",
  "ready",
] as const;

export type WorkOrderBoardFilter = "all" | "overdue" | "quoted" | "ready" | "pending" | "today";

/** Botón de avance del flujo: de "recibida" se puede saltar a cualquiera. */
export function workOrderNextLabel(status: unknown): string {
  const s = String(status || "pending");
  switch (s) {
    case "pending":
      return "Diagnosticar";
    case "diagnosed":
      return "Presupuestar";
    case "quoted":
      return "Aprobar trabajo";
    case "approved":
      return "Pasar a reparación";
    case "repairing":
      return "Esperar repuesto";
    case "waiting_parts":
      return "Marcar lista";
    case "ready":
      return "Entregar";
    default:
      return "";
  }
}

/**
 * Estado siguiente del flujo (para el botón de avance): null si ya está al
 * final o es terminal.
 */
export function workOrderNextState(status: unknown): WorkOrderState | null {
  const s = String(status || "pending");
  const idx = WORK_ORDER_FLOW.findIndex((x) => x === s);
  if (idx < 0 || idx === WORK_ORDER_FLOW.length - 1) return null;
  return WORK_ORDER_FLOW[idx + 1];
}

/**
 * Acciones rápidas de la tarjeta (todo saltable): cada una lleva directo a un
 * estado, sin obligar a pasar por los anteriores.
 */
export function workOrderQuickActions(status: unknown): { to: string; label: string }[] {
  const s = String(status || "pending");
  if (s === "completed" || s === "cancelled") return [];
  const order = ["diagnosed", "quoted", "approved", "repairing", "waiting_parts", "ready", "completed"] as const;
  const currentIdx = order.findIndex((x) => x === s);
  return order
    .filter((to) => currentIdx < 0 || to > s)
    .map((to) => ({ to, label: `→ ${workOrderStateLabel(to)}` }));
}

/** Etiqueta de la orden para listas: "Orden N° 12". */
export function workOrderTitle(no: unknown): string {
  const n = Number(no);
  return Number.isFinite(n) && n > 0 ? `Orden N° ${n}` : "Orden de servicio";
}

/** "Ingresa 06/11 → Entrega 10/11" (fechas cortas AR, sin hora). */
export function workOrderDatesLabel(intakeISO: unknown, deliveryISO: unknown): string {
  const intake = fmtCorta(intakeISO);
  const delivery = fmtCorta(deliveryISO);
  if (!intake && !delivery) return "";
  if (intake && delivery) return `Ingresa ${intake} → Entrega ${delivery}`;
  if (intake) return `Ingresa ${intake}`;
  return `Entrega ${delivery}`;
}

function fmtCorta(v: unknown): string {
  const s = String(v || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

/**
 * Semáforo de la entrega para la tarjeta: vence hoy / mañana / vencida.
 * Devuelve junto al texto el tono de color.
 */
export function workOrderDeliveryDue(deliveryISO: unknown, status: unknown): { text: string; tone: string } | null {
  if (status === "completed" || status === "cancelled") return null;
  const s = String(deliveryISO || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const today = isoTodayAR();
  if (s === today) return { text: "Entrega hoy", tone: "text-red-600 font-semibold" };
  if (s < today) return { text: `Entrega vencida (${fmtCorta(s)})`, tone: "text-red-600 font-semibold" };
  const diff = daysBetween(today, s);
  if (diff === 1) return { text: "Entrega mañana", tone: "text-amber-600 font-medium" };
  if (diff <= 3) return { text: `Entrega en ${diff} días`, tone: "text-muted-foreground" };
  return null;
}

/** ISO "YYYY-MM-DD" en TZ Argentina (mismo día que ve el comercio). */
export function isoTodayAR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

/** Mensaje de WhatsApp para avisar una prórroga de entrega. */
export function workOrderExtensionText(opts: {
  storeName: string;
  customerName: string | null;
  orderNo: unknown;
  newDeliveryISO: string;
  equipmentLabel?: string | null;
}): string {
  const { storeName, customerName, orderNo, newDeliveryISO, equipmentLabel: eq } = opts;
  const name = String(customerName || "").split(/\s+/)[0] || "";
  const eqTxt = eq ? ` de tu ${eq}` : "";
  const newDate = new Date(`${String(newDeliveryISO).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return `Hola${name ? ` ${name}` : ""}! Te escribimos de ${storeName} 🛠️ La orden N° ${Number(orderNo) || "—"}${eqTxt} va a estar lista el **${newDate}** (nueva fecha estimada). Si tenés alguna duda, respondé este mensaje. ¡Gracias por esperar!`;
}

/** Default inteligente de fecha de entrega (hoy + 3 días). */
export function defaultDeliveryISO(): string {
  const d = new Date(`${isoTodayAR()}T12:00:00`);
  d.setDate(d.getDate() + 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Checklist de ingreso (opcional, genérico para cualquier rubro del taller:
// bicicletería, electrónica, electrodomésticos, hogar, calzado, cerrajería).
// ---------------------------------------------------------------------------

export type IntakeChecklist = {
  /** Accesorios que entrega el cliente (etiquetas exactas de ACCESORIO_PRESETS o libres). */
  accessories?: string[];
  /** Otros accesorios / detalle libre. */
  other?: string;
  /** Contraseña, patrón o PIN de desbloqueo (sensible: solo panel). */
  unlock?: string;
  /** Estado físico al recibir (rayones, golpes, falta X...). */
  condition?: string;
};

/** Presets genéricos de accesorios (se tilda lo que aplica, en cualquier rubro). */
export const ACCESORIO_PRESETS = [
  "Cargador",
  "Cable",
  "Funda / estuche",
  "Control remoto",
  "Memoria / SIM",
  "Manuales",
  "Pilas / baterías",
  "Llaves",
  "Soporte / accesorios",
] as const;

export function emptyChecklist(): IntakeChecklist {
  return { accessories: [] };
}

/** ¿Hay algo cargado? Vacío = la sección no se muestra en la ficha. */
export function hasChecklistContent(c: IntakeChecklist | null | undefined): boolean {
  if (!c || typeof c !== "object") return false;
  return (
    (Array.isArray(c.accessories) && c.accessories.length > 0) ||
    !!(c.other && String(c.other).trim()) ||
    !!(c.unlock && String(c.unlock).trim()) ||
    !!(c.condition && String(c.condition).trim())
  );
}

/** Normaliza el checklist que llega del cliente (tolerante a basura). */
export function normalizeChecklist(raw: unknown): IntakeChecklist {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const accessories = Array.isArray(o.accessories)
    ? o.accessories.map((x) => String(x || "").trim().slice(0, 60)).filter(Boolean).slice(0, 12)
    : [];
  const str = (v: unknown) => (v != null ? String(v).trim().slice(0, 300) : "");
  return {
    accessories,
    other: str(o.other) || undefined,
    unlock: str(o.unlock) || undefined,
    condition: str(o.condition) || undefined,
  };
}

/** Resumen de una línea para la tarjeta: "Cargador, Cable +2 · contraseña". */
export function checklistSummaryLabel(c: IntakeChecklist | null | undefined): string {
  if (!hasChecklistContent(c)) return "";
  const bits: string[] = [];
  const acc = c?.accessories || [];
  if (acc.length > 0) {
    bits.push(acc.slice(0, 2).join(", ") + (acc.length > 2 ? ` +${acc.length - 2}` : ""));
  }
  if (c?.other) bits.push(c.other.slice(0, 30));
  if (c?.unlock) bits.push("🔑 contraseña");
  return bits.join(" · ");
}

// ---------------------------------------------------------------------------
// Presets de falla declarada por rubro (chips de un toque en el intake).
// ---------------------------------------------------------------------------

const FAULT_PRESETS: { match: RegExp; label: string; items: string[] }[] = [
  {
    match: /bici|cycl|bicicle/i,
    label: "Bicicletería",
    items: ["Pinchadura", "Frenos", "Cambios / transmisión", "Service general", "Centrado de rueda", "Ruido al pedalear", "Armado de bici"],
  },
  {
    match: /celular|móvil|movil|comput|inform|electrón|electron|techno/i,
    label: "Electrónica",
    items: ["Pantalla rota", "Batería", "No enciende", "No carga", "Mojo / líquidos", "Software / sistema", "Cámara", "Audio / parlante"],
  },
  {
    match: /electrodom|hogar|helader|lavar|cocina/i,
    label: "Electrodomésticos",
    items: ["No enciende", "No calienta", "No enfría", "Ruido / vibración", "Pérdida de agua", "Service general"],
  },
  {
    match: /gomer|neumát|llanta/i,
    label: "Gomería",
    items: ["Pinchadura", "Parche", "Cambio de neumático", "Alineación", "Balanceo"],
  },
  {
    match: /calzado|zapater|shoe/i,
    label: "Calzado",
    items: ["Resoleado", "Costura / pegado", "Cambio de taco", "Reparación general"],
  },
  {
    match: /cerraj|llave|lock/i,
    label: "Cerrajería",
    items: ["Apertura", "Cambio de cerradura", "Copia de llave", "Reparación de cerradura"],
  },
];

const FAULT_PRESETS_DEFAULT = ["Reparación general", "Service / mantenimiento", "Diagnóstico", "A presupuesto"];

/** Chips de falla según el rubro del comercio (fallback genérico). */
export function faultPresetsFor(category: unknown): { label: string; items: string[] } {
  const cat = String(category || "");
  for (const p of FAULT_PRESETS) {
    if (p.match.test(cat)) return { label: p.label, items: p.items };
  }
  return { label: "Fallas frecuentes", items: FAULT_PRESETS_DEFAULT };
}

// ---------------------------------------------------------------------------
// Presupuesto sin respuesta (Orderry: "estimate not approved after 48h →
// follow-up"). El badge aparece a las 48h y el WA sale precargado.
// ---------------------------------------------------------------------------

export const QUOTE_FOLLOWUP_HOURS = 48;

/** ¿El presupuesto lleva más de 48h enviado (responded) sin respuesta? */
export function quoteNeedsFollowUp(quote: { status?: unknown; created_at?: unknown } | null | undefined): boolean {
  if (!quote || String(quote.status || "") !== "responded") return false;
  const at = String(quote.created_at || "");
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > QUOTE_FOLLOWUP_HOURS * 60 * 60 * 1000;
}

/** Mensaje de seguimiento precargado para el WA del presupuesto. */
export function quoteFollowUpText(opts: {
  storeName: string;
  customerName: string | null;
  serviceName?: string | null;
  price?: number | null;
}): string {
  const { storeName, customerName, serviceName, price } = opts;
  const name = String(customerName || "").split(/\s+/)[0] || "";
  const what = serviceName ? `del ${serviceName}` : "que te enviamos";
  const priceTxt = Number(price) > 0 ? ` ($${Number(price).toLocaleString("es-AR")})` : "";
  return `Hola${name ? ` ${name}` : ""}! Te escribimos de ${storeName} 🛠️ ¿Pudiste ver el presupuesto ${what}${priceTxt}? Si te queda bien, respondé este mensaje y arrancamos con el trabajo. Cualquier duda, preguntanos.`;
}
