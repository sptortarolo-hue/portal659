/**
 * Ficha de equipo (bicicleta / moto / electrodoméstico / equipo) — helpers
 * client-safe. El taller/servicio guarda el equipo que interviene en cada
 * trabajo (presupuesto, turno, recepción) separado del cliente, para:
 *  - historial por equipo ("¿qué trabajos tuvo esta bici?")
 *  - recuerdo del cliente en recepción (seleccionar la bici trae su pasado)
 *  - los documentos (A4/PDF) imprimiendo qué equipo se trabajó.
 */

export type EquipmentKind = "bici" | "moto" | "automotor" | "electro" | "otro";

export type Equipment = {
  id: string;
  vendor_id?: string;
  kind?: EquipmentKind;
  brand: string | null;
  model: string | null;
  /** N° de cuadro / serie. */
  identifier: string | null;
  /** Medida de rueda en bicis ("29") o dato libre ("7 kg", "XL"). */
  rodado: string | null;
  color: string | null;
  notes: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  /** Foto de recepción (condición al ingreso). */
  photo_url?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Agregadas por el server al listar (historial por equipo). */
  jobs?: number;
  last_job_at?: string | null;
};

/** "Bicicleta Scott XT · Rodado 29 · N° ABC123 · Rojo" (todo opcional). */
export function equipmentLabel(e: Equipment | null | undefined): string {
  if (!e) return "";
  const head = [e.brand, e.model].filter(Boolean).join(" ");
  const bits = [head || null, e.rodado ? `Rodado ${e.rodado}` : null, e.identifier ? `N° ${e.identifier}` : null, e.color].filter(Boolean);
  const label = bits.join(" · ");
  return label || (e.id ? "Equipo sin ficha de datos" : "");
}

/** ¿Hay algo que valga para crear/asociar un equipo? (marca/modelo o serie). */
export function equipmentHasContent(e: Pick<Equipment, "brand" | "model" | "identifier" | "rodado" | "color"> | null | undefined): boolean {
  if (!e) return false;
  return [e.brand, e.model, e.identifier, e.rodado, e.color].some((v) => String(v || "").trim() !== "");
}

/** Normaliza a texto corto por si el comercio puso todo junto ("Scott XT #123"). */
export function equipmentKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "moto":
      return "Moto";
    case "automotor":
      return "Auto";
    case "electro":
      return "Electrodoméstico";
    case "otro":
      return "Equipo";
    default:
      return "Bicicleta";
  }
}

/**
 * Variantes del teléfono para buscar en la base (matching laxo por sufijo):
 * crudo, sin 549, sin 54, con 549, con 54 — todas las formas frecuentes en AR.
 */
export function phoneVariants(phone: string): string[] {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return [];
  const variants = new Set<string>([digits]);
  const stripInter = digits.replace(/^549/, "").replace(/^54/, "");
  variants.add(stripInter);
  variants.add(`549${stripInter}`);
  variants.add(`54${stripInter}`);
  return Array.from(variants).filter((v) => v.length >= 6);
}

/** Mensaje WA precargado para recordar el service por equipo. */
export function equipmentServiceReminderText(opts: {
  storeName: string;
  customerName: string;
  equipment: Equipment;
  lastJobAt?: string | null;
}): string {
  const { storeName, customerName, equipment, lastJobAt } = opts;
  const name = String(customerName || "").trim().split(/\s+/)[0] || "cliente";
  const eqLabel = equipmentLabel(equipment) || "tu equipo";
  let ago = "";
  if (lastJobAt) {
    const ms = Date.now() - new Date(lastJobAt).getTime();
    const months = Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44));
    if (months >= 1) ago = ` Ya pasaron ${months} ${months === 1 ? "mes" : "meses"} de tu último service.`;
  }
  return `Hola ${name}! Te escribirnos de ${storeName} 🚲 Tenemos tu ${eqLabel} registrada.${ago} ¿Querés que te anotemos para el próximo service?`;
}
