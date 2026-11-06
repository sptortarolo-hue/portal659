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

export type WorkOrderBoardFilter = "all" | "overdue" | "ready" | "pending";

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
