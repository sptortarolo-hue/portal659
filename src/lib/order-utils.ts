import type { Order, OrderStatus } from "@/types/database";

/**
 * True si el pedido tiene al menos un ítem que requiere elaboración de cocina.
 * Ítems antiguos sin el flag se tratan como "requieren cocina" (compatible).
 * Un pedido de solo bebidas/packs (mostrador/mesa) no entra al flow de cocina.
 */
export function orderNeedsKitchen(
  order: Pick<Order, "items">
): boolean {
  return (order.items || []).some((i) => i?.requires_prep !== false);
}

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // "confirmed" (aceptación explícita) lo usa el vertical moda; gastronomía
  // salta directo de new a preparing (su UI nunca emite "confirmed").
  // Mostrador/mesa saltean "preparación": de new pasan directo a ready
  // ("Listo p/ entregar"); la cocina igual los ve en la comanda.
  new: ["confirmed", "preparing", "ready", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["sent", "completed", "cancelled"],
  sent: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function formatPhone(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Normaliza un teléfono argentino a formato E.164 (+549XXXXXXXXXX para móvil,
 * +54XXXXXXXXXX para fijo), compatible con WhatsApp y libphonenumber de Google.
 * Acepta formatos: 2215550000, 1155550000, 92215550000, 5492215550000, +54 9 221 555-0000, etc.
 */
export function normalizePhoneAR(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";

  // Si ya tiene código de país 54
  if (digits.startsWith("54")) {
    const rest = digits.slice(2);
    // Móvil: 9 + código de área (2-4 dígitos) + número
    if (rest.startsWith("9") && rest.length >= 11) {
      return "+54" + rest;
    }
    // Fijo: código de área + número
    if (rest.length >= 10) {
      return "+54" + rest;
    }
    return "+54" + rest;
  }

  // Si empieza con 9, es móvil con prefijo 9 (formato local con 9)
  if (digits.startsWith("9") && digits.length >= 11) {
    return "+54" + digits;
  }

  // Código de área conocido (10 dígitos: código de área 2-4 dígitos + 8 dígitos)
  // Códigos de área principales: 11, 221, 223, 261, 341, 351, 358, 376, 381, 385, 387, 388
  const areaCodes = ["11", "221", "223", "261", "341", "351", "358", "376", "381", "385", "387", "388"];
  for (const ac of areaCodes) {
    if (digits.startsWith(ac) && digits.length === 10) {
      // Fijo: +54 + código + número
      return "+54" + digits;
    }
    if (digits.startsWith("9" + ac) && digits.length === 11) {
      // Móvil con 9: +549 + código + número
      return "+54" + digits;
    }
  }

  // Heurística genérica: 10 dígitos -> asumir fijo, 11 con 9 -> móvil
  if (digits.length === 10) return "+54" + digits;
  if (digits.length === 11 && digits.startsWith("9")) return "+54" + digits;

  // Fallback: devolver con +54
  return "+54" + digits;
}

export function isValidPhone(phone: string): boolean {
  const clean = formatPhone(phone);
  return clean.length >= 10 && clean.length <= 15;
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

export function estimatedRemaining(estimatedMinutes: number, createdAt: string): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const elapsed = Math.floor((now - created) / 60000);
  return Math.max(0, estimatedMinutes - elapsed);
}

export function progressPercent(status: OrderStatus): number {
  const map: Record<OrderStatus, number> = {
    new: 0,
    confirmed: 25,
    preparing: 50,
    ready: 75,
    sent: 90,
    completed: 100,
    cancelled: 0,
  };
  return map[status] ?? 0;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  preparing: "En preparación",
  ready: "Listo",
  sent: "Enviado",
  completed: "Entregado",
  cancelled: "Cancelado",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  new: "bg-blue-100 text-blue-700 border-blue-200",
  confirmed: "bg-amber-100 text-amber-700 border-amber-200",
  preparing: "bg-orange-100 text-orange-700 border-orange-200",
  ready: "bg-green-100 text-green-700 border-green-200",
  sent: "bg-purple-100 text-purple-700 border-purple-200",
  completed: "bg-gray-100 text-gray-500 border-gray-200",
  cancelled: "bg-red-100 text-red-600 border-red-200",
};

// Retail (moda y comercio de barrio): el pedido se acepta/rechaza por stock
// y se empaqueta; no hay cocina. Los estados son los mismos, cambian los
// nombres visibles.
export const RETAIL_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Por aceptar",
  confirmed: "Aceptado",
  preparing: "Empaquetando",
  ready: "Listo",
  sent: "En camino",
  completed: "Entregado",
  cancelled: "Cancelado",
};

/** @deprecated usar RETAIL_STATUS_LABELS (queda como alias por compatibilidad). */
export const MODA_STATUS_LABELS = RETAIL_STATUS_LABELS;

/** `isRetail` = vertical moda o comercio (flow con aceptación explícita). */
export function statusLabel(status: OrderStatus, isRetail: boolean): string {
  return isRetail ? RETAIL_STATUS_LABELS[status] : ORDER_STATUS_LABELS[status];
}

export function flowSteps(isRetail: boolean): OrderStatus[] {
  return isRetail
    ? ["new", "confirmed", "preparing", "ready", "sent", "completed"]
    : ["new", "preparing", "ready", "sent", "completed"];
}

/**
 * Próximo estado del pedido según el flow del vertical/canal.
 * - Mostrador/mesa SIN cocina (solo bebidas/packs): `new` salta a `ready`
 *   (2 pasos: "Listo p/ entregar"), sin pasar por comanda.
 * - Mostrador/mesa CON cocina: flow normal (`new` → `preparing` → ...).
 * - Retail (moda/comercio, app): `new` → `confirmed` (aceptación explícita).
 * - Gastro/app: `new` → `preparing`.
 * `null` en estados terminales.
 */
export function nextStatusFor(
  status: OrderStatus,
  method?: "delivery" | "pickup",
  isRetail: boolean = false,
  channel?: Order["channel"],
  needsKitchen: boolean = true
): OrderStatus | null {
  if (status === "ready" && method === "pickup") return "completed";
  if (
    (channel === "mostrador" || channel === "mesa") &&
    status === "new" &&
    !needsKitchen
  )
    return "ready";
  switch (status) {
    case "new":
      return isRetail ? "confirmed" : "preparing";
    case "confirmed":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return "sent";
    case "sent":
      return "completed";
    default:
      return null;
  }
}

export type OrderCondition = "delivery" | "retiro" | "mostrador" | "mesa";

export function orderCondition(order: Pick<Order, "channel" | "method">): OrderCondition {
  // El envío a domicilio gana sobre el canal: un pedido de mostrador con
  // method='delivery' se despacha (flow de envío), no se entrega en mostrador.
  if (order.method === "delivery") return "delivery";
  if (order.channel === "mostrador") return "mostrador";
  if (order.channel === "mesa") return "mesa";
  return "retiro";
}

export const CONDITION_META: Record<OrderCondition, { label: string; emoji: string; pillClass: string }> = {
  delivery: {
    label: "Delivery",
    emoji: "🛵",
    pillClass: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900",
  },
  retiro: {
    label: "Retira local",
    emoji: "🏪",
    pillClass: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900",
  },
  mostrador: {
    label: "Mostrador",
    emoji: "🛎️",
    pillClass: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  },
  mesa: {
    label: "Mesa",
    emoji: "🍽️",
    pillClass: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  },
};

export function orderReadyLabel(order: Pick<Order, "channel" | "method">): string {
  switch (orderCondition(order)) {
    case "delivery": return "Listo para envío";
    case "retiro": return "Listo para retiro";
    case "mostrador": return "Listo mostrador";
    case "mesa": return "Listo mesa";
  }
}

export function orderCompleteActionLabel(order: Pick<Order, "channel" | "method">): string {
  switch (orderCondition(order)) {
    case "delivery": return "Marcar como enviado";
    case "retiro": return "Marcar como entregado";
    case "mostrador": return "Entregar en mostrador";
    case "mesa": return "Llevar a la mesa";
  }
}

export const KDS_COLUMNS: { status: OrderStatus; label: string; emoji: string }[] = [
  { status: "new", label: "Nuevos", emoji: "🆕" },
  { status: "preparing", label: "Preparando", emoji: "🍳" },
  { status: "ready", label: "Listos", emoji: "📦" },
  { status: "sent", label: "Enviados", emoji: "🚚" },
];

/** Etiqueta visible del número de pedido diario (ej. "Nro. 12" para comanda, "Retiro Nro. 7" para retiros). */
export function orderNumberLabel(order: Pick<Order, "channel" | "method"> & { pickup_number?: number | null; table_name?: string | null }): string {
  const n = order.pickup_number;
  if (n == null) return "Nro. ?";

  const channel = order.channel;

  // Formato único (cantar al caja): número corto y claro por canal.
  if (channel === "mesa") return `Mesa ${order.table_name || "—"} · Nro. ${n}`;
  if (channel === "mostrador") {
    if (order.method === "delivery") return `Envío Nro. ${n}`;
    return `Mostrador Nro. ${n}`;
  }
  // app / otros
  if (order.method === "delivery") return `Envío Nro. ${n}`;
  return `Retiro Nro. ${n}`;
}

/** Versión corta pensada para chips pequeños: "Nro. 7" (o "#a1b2c3d4" si no hay número). */
export function orderNumberShort(order: Pick<Order, "id"> & { pickup_number?: number | null }): string {
  return order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`;
}

export function buildClientWhatsAppMessage(
  status: OrderStatus,
  order: Order,
  vendorName: string,
): string {
  const orderId = order.id.slice(0, 8);

  switch (status) {
    case "ready":
      if (order.method === "pickup") {
        return `Hola ${order.customer_name}! Tu pedido #${orderId} de ${vendorName} ya esta listo para retirar. Pasalo a buscar cuando quieras!`;
      }
      return `Hola ${order.customer_name}! Tu pedido #${orderId} de ${vendorName} esta casi listo, saliendo para tu domicilio.`;
    case "sent":
      return `Hola ${order.customer_name}! Tu pedido #${orderId} de ${vendorName} ya salio para entregar. Gracias por tu compra!`;
    case "completed":
      return `Hola ${order.customer_name}! Tu pedido #${orderId} de ${vendorName} fue entregado. Gracias por elegirnos!`;
    default:
      return "";
  }
}

export function buildClientWhatsAppUrl(
  status: OrderStatus,
  order: Order,
  vendorName: string,
): string | null {
  const phone = order.customer_phone?.replace(/\D/g, "");
  if (!phone) return null;

  const msg = buildClientWhatsAppMessage(status, order, vendorName);
  if (!msg) return null;

  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

export function buildOrderWhatsAppMessage(params: {
  vendorName: string;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  customerName: string;
  customerPhone: string;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  notes?: string;
}): string {  const lines = params.items.map((i) => {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? ` (${i.modifiers.join(", ")})`
      : "";
    return `- ${i.qty}x ${i.name}${modStr} ($${(i.price * i.qty).toLocaleString("es-AR")})`;
  });

  const paymentLine = params.paymentMethod === "transferencia"
    ? "\nTransferencia: CBU/Alias te lo paso por WhatsApp"
    : params.paymentMethod === "efectivo"
    ? "\nPago en efectivo al recibir"
    : "";

  const notesLine = params.notes ? `\nNotas: ${params.notes}` : "";

  return [
    `Hola ${params.vendorName}! Quiero hacer un pedido:`,
    "",
    ...lines,
    "",
    `Total: $${params.total.toLocaleString("es-AR")}`,
    `Nombre: ${params.customerName}`,
    `WhatsApp: ${params.customerPhone}`,
    params.method === "delivery" ? `Direccion: ${params.address || "sin direccion"}` : "Retiro en el local",
    notesLine,
    paymentLine,
  ].filter(Boolean).join("\n");
}

export type ContextualWaResult = {
  url: string;
  label: string;
  variant?: "transfer" | "info" | "libre";
};

export function buildContextualWhatsApp(
  order: Order,
  vendorName: string,
  transfer?: { alias: string | null; cbu: string | null; holder: string | null },
  resolveTransferMessage?: () => string | null,
  isRetail: boolean = false,
): ContextualWaResult | null {
  const phone = order.customer_phone?.replace(/\D/g, "");
  if (!phone) return null;

  const isTransferApp =
    order.payment_method === "transferencia" &&
    order.channel === "app" &&
    order.payment_status === "pending";

  if (isTransferApp) {
    const msg = resolveTransferMessage && resolveTransferMessage();
    if (msg && transfer?.alias) {
      return {
        url: `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`,
        label: "💸 Datos de pago (WA)",
        variant: "transfer",
      };
    }
  }

  if (["ready", "sent", "completed"].includes(order.status)) {
    const url = buildClientWhatsAppUrl(order.status, order, vendorName);
    if (url) {
      const label =
        order.status === "ready"
          ? order.method === "pickup"
            ? "🛵 Avisar retiro"
            : "🛵 Avisar envío"
          : order.status === "sent"
            ? "🚚 Avisar envío"
            : "✅ Avisar entrega";
      return { url, label, variant: "info" };
    }
  }

  if (["new", "confirmed", "preparing"].includes(order.status)) {
    const confirmMsg = isRetail
      ? `Hola ${order.customer_name}! Tu pedido #${order.id.slice(0, 8)} de ${vendorName} fue confirmado y ya lo estamos empaquetando. Te avisamos cuando esté. 📦`
      : `Hola ${order.customer_name}! Tu pedido #${order.id.slice(0, 8)} de ${vendorName} fue confirmado y ya está en preparación. Te avisamos cuando esté. 🍳`;
    const stageLabel =
      order.status === "new"
        ? "📨 Avisar recibido"
        : "✅ Avisar confirmado";
    const stageMsg =
      order.status === "new"
        ? `Hola ${order.customer_name}! Recibimos tu pedido #${order.id.slice(0, 8)} de ${vendorName}. Ya lo estamos viendo. 🙌`
        : confirmMsg;
    return {
      url: `https://wa.me/${phone}?text=${encodeURIComponent(stageMsg)}`,
      label: stageLabel,
      variant: "info",
    };
  }

  return null;
}

/**
 * Hora de corte de la jornada comercial (hora local del navegador).
 * Los comercios gastronómicos suelen cerrar pasada la medianoche: un pedido
 * entregado a las 01:30 sigue perteneciendo a la jornada del día anterior.
 */
export const BUSINESS_DAY_CUTOFF_HOUR = 5;

/**
 * True si dos fechas pertenecen a la misma jornada comercial: se les resta
 * `cutoffHour` horas a ambas antes de comparar el día calendario.
 * Ej. con corte a las 5am, lunes 01:30 y domingo 20:00 son la misma jornada.
 */
export function isSameBusinessDay(
  a: string | Date,
  b: string | Date = new Date(),
  cutoffHour: number = BUSINESS_DAY_CUTOFF_HOUR
): boolean {
  const shift = cutoffHour * 3_600_000;
  const da = new Date(new Date(a).getTime() - shift);
  const db = new Date(new Date(b).getTime() - shift);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
