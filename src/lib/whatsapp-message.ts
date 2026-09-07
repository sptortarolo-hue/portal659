export function buildOrderMessage(params: {
  vendorName: string;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  customerName: string;
  customerPhone: string;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  notes?: string;
}): string {
  const lines = params.items.map((i) => {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? ` (${i.modifiers.join(", ")})`
      : "";
    return `- ${i.qty}x ${i.name}${modStr} ($${(i.price * i.qty).toLocaleString("es-AR")})`;
  });

  const paymentLine = params.paymentMethod === "transferencia"
    ? "\n💰 Transferencia: CBU/Alias te lo paso por WhatsApp"
    : params.paymentMethod === "efectivo"
    ? "\n💵 Pago en efectivo al recibir"
    : "";

  const notesLine = params.notes ? `\n📝 Notas: ${params.notes}` : "";

  return [
    `Hola ${params.vendorName}! Quiero hacer un pedido:`,
    "",
    ...lines,
    "",
    `Total: $${params.total.toLocaleString("es-AR")}`,
    `Nombre: ${params.customerName}`,
    `WhatsApp: ${params.customerPhone}`,
    params.method === "delivery" ? `Dirección: ${params.address || "sin dirección"}` : "Retiro en el local",
    notesLine,
    paymentLine,
  ].filter(Boolean).join("\n");
}

export function buildComandaWhatsApp(params: {
  vendorName: string;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  customerName: string;
  customerPhone: string;
  method: "delivery" | "pickup";
  address?: string;
  paymentMethod?: string;
  notes?: string;
  orderId?: string;
  trackUrl?: string;
}): string {
  const sep = "------------------------------";
  const id = params.orderId ? params.orderId.slice(0, 8) : "--------";
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  const methodStr = params.method === "delivery" ? "*Delivery*" : "*Retiro en local*";
  const paymentStr =
    params.paymentMethod === "efectivo" ? "Efectivo" :
    params.paymentMethod === "transferencia" ? "Transferencia" :
    "Coordinar";

  const itemLines: string[] = [];
  for (const i of params.items) {
    const modStr = i.modifiers && i.modifiers.length > 0
      ? `\n  (${i.modifiers.join(", ")})`
      : "";
    itemLines.push(`${i.qty}x ${i.name}${modStr}  $${(i.price * i.qty).toLocaleString("es-AR")}`);
  }

  const notesLine = params.notes ? `\nNotas: ${params.notes}` : "";
  const addressLine = params.method === "delivery" && params.address ? `Dir: ${params.address}` : "";
  const trackLine = params.trackUrl ? `\nSeguí tu pedido acá: ${params.trackUrl}` : "";

  return [
    `*${params.vendorName}*`,
    sep,
    `*PEDIDO #${id}*`,
    `${dateStr} ${timeStr}`,
    sep,
    `${methodStr}  |  ${paymentStr}`,
    sep,
    ...itemLines,
    sep,
    `TOTAL: *$${params.total.toLocaleString("es-AR")}*`,
    "",
    `Cliente: ${params.customerName}`,
    `Tel: ${params.customerPhone}`,
    addressLine,
    notesLine,
    trackLine,
    "",
    sep,
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

export function buildModifiedOrderMessage(params: {
  vendorName: string;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
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
    return `${i.qty}x ${i.name}${modStr}  $${(i.price * i.qty).toLocaleString("es-AR")}`;
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
      "Si esta todo bien, respondeme *SI* para confirmar.",
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
  const credentials = params.cbu
    ? `*Alias:* ${params.alias}\n*CBU:* ${params.cbu}`
    : `*Alias:* ${params.alias}`;
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

