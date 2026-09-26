import {
  BookOpen,
  CreditCard,
  MapPin,
  Phone,
  Printer,
  Receipt,
  ShoppingBag,
  Store,
  Users,
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
  ubicacion: MapPin,
  contacto: Phone,
  pagos: CreditCard,
  equipo: Users,
  impresora: Printer,
  fiscal: Receipt,
  menu: BookOpen,
  catalogo: ShoppingBag,
};

export const CONFIG_SECTION_DESCS: Record<string, string> = {
  perfil: "Nombre, descripción, fotos y galería de tu vidriera.",
  ubicacion: "Dónde estás y cuándo abrís.",
  contacto: "Cómo te contactan tus clientes.",
  pagos: "Medios de pago, entrega, Mercado Pago y venta online.",
  equipo: "Tiempos, personal y reparto.",
  impresora: "Tickets y comandas en papel.",
  fiscal: "Factura electrónica ARCA.",
  menu: "Acceso rápido a tu carta.",
  catalogo: "Categorías y modificadores.",
};

export const CONFIG_SECTION_GROUPS: Array<{
  id: string;
  label: string;
  sections: string[];
}> = [
  { id: "negocio", label: "Local", sections: ["perfil", "ubicacion", "contacto"] },
  { id: "ventas", label: "Ventas", sections: ["pagos", "menu", "catalogo"] },
  { id: "operacion", label: "Operación", sections: ["equipo", "impresora", "fiscal"] },
];

export const CONFIG_SECTION_FALLBACK_ICON: LucideIcon = Settings2;

export const CONFIG_SECTION_LABELS: Record<string, string> = {
  perfil: "Perfil",
  ubicacion: "Ubicación y horarios",
  contacto: "Contacto y redes",
  pagos: "Pagos y entrega",
  equipo: "Equipo y preparación",
  impresora: "Impresora",
  fiscal: "Facturación",
  menu: "Menú",
  catalogo: "Catálogo",
};

/** Secciones disponibles por vertical (orden de la nav). */
export function sectionsForVertical(vertical: string | null | undefined): string[] {
  switch (vertical) {
    case "gastronomia":
      return ["perfil", "ubicacion", "contacto", "pagos", "equipo", "impresora", "fiscal", "menu"];
    case "comercio":
      return ["perfil", "ubicacion", "contacto", "pagos", "impresora", "fiscal", "catalogo"];
    case "moda":
      return ["perfil", "ubicacion", "contacto", "pagos", "impresora", "fiscal"];
    default:
      return ["perfil", "ubicacion", "contacto", "pagos"];
  }
}

export function configSectionIcon(id: string): LucideIcon {
  return CONFIG_SECTION_ICONS[id] ?? CONFIG_SECTION_FALLBACK_ICON;
}

/** Dot de estado desde el vendor (sin fetches). undefined = sin dot. */
export function configSectionStatus(
  id: string,
  vendor: Pick<Vendor, "printer_ip" | "print_mode" | "fiscal_cert" | "cuit" | "mp_user_id"> | null | undefined
): ConfigSectionStatus | undefined {
  if (!vendor) return undefined;
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
