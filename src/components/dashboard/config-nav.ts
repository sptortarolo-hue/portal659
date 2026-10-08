import {
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Gift,
  MapPin,
  Phone,
  Printer,
  QrCode,
  Receipt,
  Share,
  ShoppingBag,
  Siren,
  Store,
  Timer,
  Users,
  Wrench,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import type { Vendor } from "@/types/database";

/**
 * Fuente única de la navegación de Configuración: la consumen la sidebar
 * principal (VendorSidebar) y el shell (ConfigSections). Así hay UNA sola
 * nav con las mismas secciones, iconos, grupos y estados.
 */
export type ConfigSectionStatus = "ok" | "warn" | "off";

export const CONFIG_SECTION_ICONS: Record<string, LucideIcon> = {
  perfil: Store,
  carta: QrCode,  ubicacion: MapPin,
  contacto: Phone,
  pagos: CreditCard,
  preparacion: Timer,
  equipo: Users,
  impresora: Printer,
  alertas: Bell,
  fiscal: Receipt,
  menu: BookOpen,
  catalogo: ShoppingBag,
  turnera: CalendarDays,
  fichas: ClipboardList,
  packs: Gift,
  servicios: Wrench,
  urgencia: Siren,
  promos: Share,
};

export const CONFIG_SECTION_DESCS: Record<string, string> = {
  perfil: "Nombre, descripción, fotos y galería de tu vidriera.",
  carta: "Carta de mesa con QR: elegí si el menú también se ve en tu tienda pública.",
  ubicacion: "Dónde estás y cuándo abrís.",
  contacto: "Cómo te contactan tus clientes.",
  pagos: "Medios de pago, entrega, Mercado Pago y venta online.",
  preparacion: "Demora que ven tus clientes en el micrositio.",
  equipo: "Repartidores y usuarios del local (nombre, nivel y contraseña).",
  impresora: "Tickets y comandas en papel.",
  alertas: "Avisos de pedido nuevo en este celu.",
  fiscal: "Abrir la pestaña Facturación: comprobantes, NC y reportes.",
  menu: "Acceso rápido a tu carta.",
  catalogo: "Categorías y modificadores.",
  turnera: "Servicios, profesionales, sedes y turnera online.",
  fichas: "Modelos de ficha por servicio.",
  packs: "Packs de sesiones, giftcards y comisiones.",
  servicios: "Qué ofrecés, zona y solicitudes online.",
  urgencia: "Emergencias 24hs y recargo.",
  promos: "Compartí tus promos en grupos de WhatsApp.",
};

export const CONFIG_SECTION_GROUPS: Array<{
  id: string;
  label: string;
  sections: string[];
}> = [
  { id: "negocio", label: "Local", sections: ["perfil", "ubicacion", "contacto"] },
  { id: "ventas", label: "Ventas", sections: ["pagos", "menu", "catalogo", "carta", "promos"] },
  { id: "turnera", label: "Turnera", sections: ["turnera", "fichas", "packs"] },
  { id: "servicio", label: "Servicio", sections: ["servicios", "urgencia"] },
  { id: "operacion", label: "Operación", sections: ["preparacion", "equipo", "impresora", "alertas", "fiscal"] },
];

export const CONFIG_SECTION_FALLBACK_ICON: LucideIcon = Settings2;

export const CONFIG_SECTION_LABELS: Record<string, string> = {
  perfil: "Perfil",
  carta: "Carta y QR",
  ubicacion: "Ubicación y horarios",
  contacto: "Contacto y redes",
  pagos: "Pagos y entrega",
  preparacion: "Tiempo de preparación",
  equipo: "Equipo y usuarios",
  impresora: "Impresora",
  alertas: "Alertas",
  fiscal: "Facturación",
  menu: "Menú",
  catalogo: "Catálogo",
  turnera: "Turnera",
  fichas: "Fichas",
  packs: "Packs y regalos",
  servicios: "Servicios",
  urgencia: "Urgencia 24hs",
  promos: "Promos",
};

/** Secciones disponibles por vertical (orden de la nav). */
export function sectionsForVertical(vertical: string | null | undefined): string[] {
  switch (vertical) {
    case "gastronomia":
      return ["perfil", "ubicacion", "contacto", "pagos", "preparacion", "equipo", "impresora", "alertas", "fiscal", "menu", "carta", "promos"];
    case "comercio":
      return ["perfil", "ubicacion", "contacto", "pagos", "equipo", "impresora", "alertas", "fiscal", "catalogo", "carta", "promos"];
    case "moda":
      return ["perfil", "ubicacion", "contacto", "pagos", "equipo", "impresora", "alertas", "fiscal", "carta", "promos"];
    case "estetica":
      return ["perfil", "ubicacion", "contacto", "pagos", "turnera", "fichas", "packs", "equipo", "impresora", "alertas", "carta", "promos"];
    case "servicio":
      return ["perfil", "ubicacion", "contacto", "servicios", "urgencia", "equipo", "carta", "promos"];
    default:
      return ["perfil", "ubicacion", "contacto", "pagos", "carta", "promos"];
  }
}

export function configSectionIcon(id: string): LucideIcon {
  return CONFIG_SECTION_ICONS[id] ?? CONFIG_SECTION_FALLBACK_ICON;
}

/** Label por sección y vertical: fuera de gastronomía la carta se llama catálogo. */
export function configSectionLabel(id: string, vertical?: string | null): string {
  if (id === "carta" && vertical != null && vertical !== "gastronomia") return "Catálogo QR";
  return CONFIG_SECTION_LABELS[id] ?? id;
}

/** Dot de estado desde el vendor (sin fetches). undefined = sin dot. */
export function configSectionStatus(
  id: string,
  vendor: Pick<Vendor, "printer_ip" | "print_mode" | "fiscal_cert" | "cuit" | "mp_user_id" | "carta_visibility"> | null | undefined
): ConfigSectionStatus | undefined {
  if (!vendor) return undefined;
  if (id === "carta") {
    return vendor.carta_visibility === "public" ? "ok" : undefined;
  }
  if (id === "impresora") {
    return vendor.printer_ip || vendor.print_mode ? "ok" : "off";
  }
  if (id === "fiscal") {
    return vendor.fiscal_cert ? "ok" : vendor.cuit ? "warn" : "off";
  }
  if (id === "pagos") {
    return vendor.mp_user_id ? "ok" : undefined;
  }
  return undefined;
}
