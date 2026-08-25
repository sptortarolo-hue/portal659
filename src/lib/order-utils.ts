import type { Order, OrderStatus } from "@/types/database";

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ["confirmed", "cancelled"],
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

export const KDS_COLUMNS: { status: OrderStatus; label: string; emoji: string }[] = [
  { status: "new", label: "Nuevos", emoji: "🆕" },
  { status: "confirmed", label: "Aceptados", emoji: "✅" },
  { status: "preparing", label: "Preparando", emoji: "🍳" },
  { status: "ready", label: "Listos", emoji: "📦" },
  { status: "sent", label: "Enviados", emoji: "🚚" },
];

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
}): string {
  const lines = params.items.map((i) => {
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
