type WaItem = {
  name: string;
  price: number;
  qty: number;
  modifiers?: string[];
  /** Total de línea pack-aware (si falta, price×qty). */
  lineTotal?: number;
  /** Unidad de venta: "kg" = fraccionado por peso. */
  unit?: string;
  /** Componentes de combo ya con variante ("1× Lisa (Blanca · M)"). */
  combo_members?: { name?: string; qty?: number }[] | null;
};

function itemTotal(i: WaItem): number {
  return i.lineTotal ?? i.price * i.qty;
}

/** "2x" o "0,500kg" según unidad. */
function qtyLabel(i: WaItem): string {
  return (i as any).unit === "kg"
    ? `${Number(i.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg`
    : `${i.qty}x`;
}

function comboSuffix(i: WaItem): string {
  const cb = Array.isArray(i.combo_members) ? i.combo_members : null;
  if (!cb || cb.length === 0) return "";
  const list = cb.map((m) => (Number(m.qty) || 1) > 1 ? `${m.qty}× ${m.name}` : m.name).join(" + ");
  return `\n     🧩 ${list}`;
}

export function buildOrderMessage(params: {
  vendorName: string;
  items: WaItem[];
  total: number;
  customerName: string;
  customerPhone: string;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  notes?: string;
  cashDiscount?: number | null;
  cashPct?: number | null;
  volumeDiscount?: number | null;
  volumeLabel?: string;
  manualDiscount?: number | null;
  manualReason?: string;
  /** Línea de envío ya compuesta (ej: "Envío (Garibaldi): $800" / "Envío: a convenir"). */
  deliveryLine?: string;
  /** Monto con el que el cliente dice abonar (efectivo + delivery). */
  cashAmount?: number | null;
}): string {
  const lines = params.items.map((i) => {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? ` (${i.modifiers.join(", ")})`
      : "";
    return `- ${qtyLabel(i)} ${i.name}${modStr} ($${itemTotal(i).toLocaleString("es-AR")})${comboSuffix(i)}`;
  });

  const paymentLine = params.paymentMethod === "transferencia"
    ? "\n💰 Transferencia: CBU/Alias te lo paso por WhatsApp"
    : params.paymentMethod === "efectivo"
    ? Number(params.cashAmount) > 0
      ? `\n💵 Pago en efectivo al recibir (abona $${Number(params.cashAmount).toLocaleString("es-AR")} — vuelto $${Math.max(0, Math.round((Number(params.cashAmount) - params.total) * 100) / 100).toLocaleString("es-AR")})`
      : "\n💵 Pago en efectivo al recibir"
    : "";

  const notesLine = params.notes ? `\n📝 Notas: ${params.notes}` : "";

  const cashLine =
    params.paymentMethod === "efectivo" && Number(params.cashDiscount) > 0
      ? `\nDesc. efectivo (${Number(params.cashPct) || 0}%): -$${Number(params.cashDiscount).toLocaleString("es-AR")}`
      : "";

  const volumeLine = Number(params.volumeDiscount) > 0
    ? `\nDesc. volumen${params.volumeLabel ? ` (${params.volumeLabel})` : ""}: -$${Number(params.volumeDiscount).toLocaleString("es-AR")}`
    : "";

  const manualLine = Number(params.manualDiscount) > 0
    ? `\nDesc. manual${params.manualReason ? ` (${params.manualReason})` : ""}: -$${Number(params.manualDiscount).toLocaleString("es-AR")}`
    : "";

  return [
    `Hola ${params.vendorName}! Quiero hacer un pedido:`,
    "",
    ...lines,
    "",
    `Total: $${params.total.toLocaleString("es-AR")}`,
    `Nombre: ${params.customerName}`,
    `WhatsApp: ${params.customerPhone}`,
    params.method === "delivery" ? `Dirección: ${params.address || "sin dirección"}` : "Retiro en el local",
    params.method === "delivery" && params.deliveryLine ? params.deliveryLine : "",
    notesLine,
    paymentLine,
    cashLine,
    volumeLine,
    manualLine,
  ].filter(Boolean).join("\n");
}

export function buildComandaWhatsApp(params: {
  vendorName: string;
  items: WaItem[];
  total: number;
  customerName: string;
  customerPhone: string;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  notes?: string;
  orderId?: string;
  trackUrl?: string;
  registerUrl?: string;
  cashDiscount?: number | null;
  cashPct?: number | null;
  volumeDiscount?: number | null;
  volumeLabel?: string;
  manualDiscount?: number | null;
  manualReason?: string;
  /** Línea de envío ya compuesta (ej: "Envío (Garibaldi): $800" / "⚠️ Envío a convenir"). */
  deliveryLine?: string;
  /** Pedido 100% giftcards: entrega digital por WhatsApp (sin retiro ni envío). */
  isGiftOrder?: boolean;
  /** Monto con el que el cliente dice abonar (efectivo + delivery). */
  cashAmount?: number | null;
}): string {
  const sep = "------------------------------";
  const id = params.orderId ? params.orderId.slice(0, 8) : "--------";
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  const methodStr = params.isGiftOrder
    ? "📲 *Entrega digital (WhatsApp)*"
    : params.method === "delivery" ? "*Delivery*" : "*Retiro en local*";
  const paymentStr =
    params.paymentMethod === "efectivo" ? "Efectivo" :
    params.paymentMethod === "transferencia" ? "Transferencia" :
    "Coordinar";
  // "¿Con cuánto abonás?": el comercio ve de cuánto es el vuelto a preparar.
  const abonaStr =
    params.paymentMethod === "efectivo" && Number(params.cashAmount) > 0
      ? ` (abona $${Number(params.cashAmount).toLocaleString("es-AR")} — vuelto $${Math.max(0, Math.round((Number(params.cashAmount) - params.total) * 100) / 100).toLocaleString("es-AR")})`
      : "";

  const itemLines: string[] = [];
  for (const i of params.items) {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? `\n  (${i.modifiers.join(", ")})`
      : "";
    itemLines.push(`${qtyLabel(i)} ${i.name}${modStr}  $${itemTotal(i).toLocaleString("es-AR")}${comboSuffix(i)}`);
  }

  const notesLine = params.notes ? `\nNotas: ${params.notes}` : "";
  const addressLine = params.method === "delivery" && params.address ? `Dir: ${params.address}` : "";
  const trackLine = params.trackUrl ? `\nSeguí tu pedido acá: ${params.trackUrl}` : "";
  const registerLine = params.registerUrl ? `\n📋 Guardá tus datos, favoritos y dejá reseñas: ${params.registerUrl}` : "";
  const cashLine =
    params.paymentMethod === "efectivo" && Number(params.cashDiscount) > 0
      ? `Desc. efectivo (${Number(params.cashPct) || 0}%): -$${Number(params.cashDiscount).toLocaleString("es-AR")}`
      : "";
  const volumeLine = Number(params.volumeDiscount) > 0
    ? `Desc. volumen${params.volumeLabel ? ` (${params.volumeLabel})` : ""}: -$${Number(params.volumeDiscount).toLocaleString("es-AR")}`
    : "";
  const manualLine = Number(params.manualDiscount) > 0
    ? `Desc. manual${params.manualReason ? ` (${params.manualReason})` : ""}: -$${Number(params.manualDiscount).toLocaleString("es-AR")}`
    : "";

  return [
    `*${params.vendorName}*`,
    sep,
    `*PEDIDO #${id}*`,
    `${dateStr} ${timeStr}`,
    sep,
    `${methodStr}  |  ${paymentStr}${abonaStr}`,
    sep,
    ...itemLines,
    sep,
    cashLine,
    volumeLine,
    manualLine,
    params.deliveryLine ? params.deliveryLine : "",
    `TOTAL: *$${params.total.toLocaleString("es-AR")}*`,
    "",
    `Cliente: ${params.customerName}`,
    `Tel: ${params.customerPhone}`,
    addressLine,
    notesLine,
    trackLine,
    registerLine,
    "",
    sep,
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

export function buildModifiedOrderMessage(params: {
  vendorName: string;
  items: WaItem[];
  total: number;
  customerName: string;
  orderId?: string;
  modificationNotes?: string;
  address?: string;
}): string {
  const sep = "------------------------------";
  const id = params.orderId ? params.orderId.slice(0, 8) : "--------";

  const itemLines = params.items.map((i) => {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? ` (${i.modifiers.join(", ")})`
      : "";
    return `${qtyLabel(i)} ${i.name}${modStr}  $${itemTotal(i).toLocaleString("es-AR")}${comboSuffix(i)}`;
  });

  const modLine = params.modificationNotes
    ? `\nObservaciones: ${params.modificationNotes}`
    : "";

  const addressLine = params.address ? `Dir: ${params.address}` : "";

  return [
    `Hola ${params.customerName}! Tu pedido #${id} de *${params.vendorName}* fue actualizado:`,
    "",
    sep,
    ...itemLines,
    sep,
    `TOTAL: *$${params.total.toLocaleString("es-AR")}*`,
    modLine,
    addressLine,
    "",
      "Si está todo bien, respondeme *SI* para confirmar.",
      sep,
    ].filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}

export function buildTransferInstructionsMessage(params: {
  vendorName: string;
  customerName: string;
  orderId: string;
  total: number;
  alias: string;
  holder: string;
  cbu?: string;
  blocked?: boolean;
}): string {
  const id = params.orderId.slice(0, 8);
  // Datos de pago presentes: alias y/o CBU (puede cargar solo uno).
  const credentials = [
    params.alias ? `*Alias:* ${params.alias}` : "",
    params.cbu ? `*CBU:* ${params.cbu}` : "",
  ].filter((l) => l !== "").join("\n");
  const closing = params.blocked
    ? "Después *enviame el comprobante por este chat* y apenas lo confirmemos arrancamos tu pedido. 🙌"
    : "Después *enviame el comprobante por este chat*. 🙌";
  return [
    `Hola ${params.customerName}! 👋`,
    `Tu pedido *#${id}* de ${params.vendorName} está pendiente de pago.`,
    "",
    `Total a transferir: *$${params.total.toLocaleString("es-AR")}*`,
    "",
    `${credentials}`,
    params.holder ? `*Titular:* ${params.holder}` : "",
    "",
    "Hacé la transferencia por el *monto exacto*.",
    closing,
  ].filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}

/**
 * Mensaje del pedido ya PESADO (modo "confirmar"): detalle con el peso real de
 * cada ítem, el total real y la acción de pago según el método elegido.
 * Manual a propósito: el comercio aprieta el botón tras revisar el total.
 */
export function buildWeighedOrderMessage(params: {
  vendorName: string;
  customerName: string;
  /** Identificador legible ("Nro. 12" o "#abcdef12"). */
  orderLabel: string;
  items: WaItem[];
  total: number;
  paymentMethod: string;
  /** Datos bancarios (solo transferencia). */
  alias?: string | null;
  cbu?: string | null;
  holder?: string | null;
  /** Link público de seguimiento (pago MP y consulta de estado). */
  trackUrl?: string | null;
  /** true = el total real difiere del estimado que declaró el cliente. */
  changedFromEstimate?: boolean;
}): string {
  const itemLines = params.items.map((i) => {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? ` (${i.modifiers.join(", ")})`
      : "";
    return `- ${qtyLabel(i)} ${i.name}${modStr}: *$${itemTotal(i).toLocaleString("es-AR")}*${comboSuffix(i)}`;
  });
  const credentials = [
    params.alias ? `Alias: ${params.alias}` : "",
    params.cbu ? `CBU: ${params.cbu}` : "",
  ].filter((l) => l !== "").join("\n");

  const paymentBlock = (() => {
    const total = `$${params.total.toLocaleString("es-AR")}`;
    switch (params.paymentMethod) {
      case "efectivo":
        return [`Pagás ${total} al recibir tu pedido. 💵`, "Si abonás con cambio, avisanos por acá."];
      case "transferencia":
        return [
          `Transferencia por ${total} (monto exacto):`,
          credentials,
          params.holder ? `Titular: ${params.holder}` : "",
          "Mandanos la foto o el PDF del comprobante por acá y lo verificamos enseguida. 🙏",
        ];
      case "mercadopago":
        return params.trackUrl
          ? [`Pagá ${total} con Mercado Pago desde el seguimiento:`, params.trackUrl]
          : [`Pagá ${total} con Mercado Pago. Te avisamos por acá con el link de pago.`];
      default:
        return [`Total: ${total}. Coordinamos el pago por este chat. 📱`];
    }
  })().filter((l) => l !== null && l !== undefined && l !== "");

  return [
    `⚖️ ¡Tu pedido ${params.orderLabel} de ${params.vendorName} ya está pesado!`,
    "",
    "Detalle (peso real):",
    ...itemLines,
    "",
    params.changedFromEstimate
      ? `Total real: *$${params.total.toLocaleString("es-AR")}* (distinto del estimado: lo pesamos en el local)`
      : `Total real: *$${params.total.toLocaleString("es-AR")}*`,
    "",
    ...paymentBlock,
    params.trackUrl && params.paymentMethod !== "mercadopago"
      ? `Seguí tu pedido acá: ${params.trackUrl}`
      : "",
  ].filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}

