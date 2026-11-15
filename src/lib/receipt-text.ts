/**
 * Comprobante del servicio **escrito** para WhatsApp.
 *
 * Es el fallback del PNG: cuando el navegador no puede adjuntar la imagen
 * (desktop / iOS), al chat del cliente le llega el comprobante escrito, con el
 * mismo estilo que usa el bot para los pedidos (emoji + *negrita* de WhatsApp
 * + viñetas + 💰 Total).
 *
 * Módulo puro (sin dependencias del server) → se puede testear con un check.
 */

export const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  whatsapp: "Coordinado",
  tarjeta: "Tarjeta",
  credito: "Tarjeta/Online",
  mixto: "Pago combinado",
  fiado: "Fiado",
};

export function paymentLabel(method?: string | null, fallback?: string | null): string {
  if (fallback) return fallback;
  const key = String(method || "").toLowerCase();
  return PAYMENT_LABELS[key] || (method ? String(method) : "");
}

export type ReceiptTextItem = {
  name: string;
  qty?: number;
  price?: number;
  modifiers?: string[];
};

export type ReceiptTextInput = {
  storeName: string;
  customerName?: string | null;
  serviceName?: string | null;
  staffName?: string | null;
  /** dd/mm/yyyy */
  date?: string | null;
  /** hh:mm */
  time?: string | null;
  durationMin?: number | null;
  locationName?: string | null;
  notes?: string | null;
  productsUsed?: string | null;
  equipmentLabel?: string | null;
  diagnosis?: string | null;
  orderNo?: string | null;
  items: ReceiptTextItem[];
  total: number;
  subtotal?: number | null;
  depositPaid?: number;
  amountPaid?: number;
  cashAmount?: number | null;
  vuelto?: number;
  paymentMethod?: string | null;
  paymentLabel?: string | null;
  invoiceNumber?: string | null;
  cae?: string | null;
  isFiscal?: boolean;
  storeUrl?: string | null;
  instagram?: string | null;
};

export function receiptMoney(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function qtyLabel(qty: number): string {
  return qty % 1 === 0 ? String(qty) : qty.toLocaleString("es-AR");
}

/**
 * Arma el comprobante escrito (estilo WhatsApp). Devuelve "" si no hay nada
 * que mostrar.
 */
export function buildReceiptText(input: ReceiptTextInput): string {
  const lines: string[] = [];

  lines.push("🧾 *Tu comprobante de servicio*");
  const store = String(input.storeName || "").trim();
  if (store) lines.push(`*${store}*`);

  // (El saludo "Hola ... Gracias por tu visita." va en el texto corto que se
  // manda antes; acá no se repite para no duplicar.)

  // ---- Datos del turno ----
  const detalle: string[] = [];
  if (input.serviceName) detalle.push(`• Servicio: ${input.serviceName}`);
  if (input.staffName) detalle.push(`• Profesional: ${input.staffName}`);
  const when = [input.date, input.time].filter(Boolean).join(" · ");
  if (when) detalle.push(`• Fecha: ${when}`);
  if (input.durationMin) detalle.push(`• Duración: ${input.durationMin} min`);
  if (input.locationName) detalle.push(`• Sede: ${input.locationName}`);
  if (input.equipmentLabel) detalle.push(`• Equipo: ${input.equipmentLabel}`);
  if (input.orderNo) detalle.push(`• Orden N°: ${input.orderNo}`);
  if (detalle.length) {
    lines.push("");
    lines.push("*Datos del turno*");
    lines.push(...detalle);
  }

  if (input.diagnosis) {
    lines.push("");
    lines.push(`*Diagnóstico*\n${input.diagnosis}`);
  }
  if (input.notes) {
    lines.push("");
    lines.push(`*Notas*\n${input.notes}`);
  }
  if (input.productsUsed) {
    lines.push("");
    lines.push(`*Productos usados*\n${input.productsUsed}`);
  }

  // ---- Partidas ----
  const items = (input.items || []).filter((i) => String(i.name || "").trim());
  if (items.length) {
    lines.push("");
    lines.push("*Detalle*");
    for (const item of items) {
      const qty = Number(item.qty || 1);
      const lineTotal = Number(item.price || 0) * qty;
      lines.push(`• ${qtyLabel(qty)}× ${String(item.name).trim()} — ${receiptMoney(lineTotal)}`);
      if (item.modifiers && item.modifiers.length) {
        lines.push(`  (${item.modifiers.join(", ")})`);
      }
    }
  }

  // ---- Totales ----
  lines.push("");
  lines.push(`💰 *Total: ${receiptMoney(input.total)}*`);

  const pay = paymentLabel(input.paymentMethod, input.paymentLabel);
  const payBits: string[] = [];
  if (pay) payBits.push(pay);
  if (input.cashAmount != null && Number(input.cashAmount) > 0) {
    payBits.push(`Abona con ${receiptMoney(input.cashAmount)}`);
  }
  if (input.vuelto != null && Number(input.vuelto) > 0) {
    payBits.push(`Vuelto ${receiptMoney(input.vuelto)}`);
  }
  if (payBits.length) lines.push(payBits.join(" · "));

  if (input.depositPaid && Number(input.depositPaid) > 0) {
    lines.push(`Seña pagada: ${receiptMoney(input.depositPaid)}`);
  }
  if (
    input.amountPaid != null &&
    Number(input.amountPaid) > 0 &&
    Number(input.amountPaid) !== Number(input.total) &&
    !(input.depositPaid && Number(input.depositPaid) > 0)
  ) {
    lines.push(`Cobrado: ${receiptMoney(input.amountPaid)}`);
  }

  // ---- Fiscal ----
  if (input.isFiscal && (input.invoiceNumber || input.cae)) {
    lines.push("");
    if (input.invoiceNumber) lines.push(`Factura C N° ${input.invoiceNumber}`);
    if (input.cae) lines.push(`CAE: ${input.cae}`);
  }

  // ---- Cierre ----
  if (input.storeUrl) {
    lines.push("");
    lines.push(`Reservá tu próximo turno 👉 ${input.storeUrl}`);
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
