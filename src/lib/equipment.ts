/**
 * Ficha de equipo (bicicleta / moto / auto / electrodoméstico / celular / PC /
 * equipo genérico) — helpers client-safe. El taller/servicio guarda el equipo
 * que interviene en cada trabajo (presupuesto, turno, recepción) separado del
 * cliente, para:
 *  - historial por equipo ("¿qué trabajos tuvo esta moto?")
 *  - recuerdo del cliente en recepción (seleccionar el equipo trae su pasado)
 *  - los documentos (A4/PDF) imprimiendo qué equipo se trabajó.
 */

export type EquipmentKind = "bici" | "moto" | "automotor" | "electro" | "celular" | "pc" | "otro";

/** Todos los tipos (el CHECK de la DB se extiende con migrate-equipment-kinds.sql;
 *  sin la migración, celular/pc se guardan como 'otro' del lado servidor). */
export const EQUIPMENT_KINDS: EquipmentKind[] = ["bici", "moto", "automotor", "electro", "celular", "pc", "otro"];

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

/** "Moto Zanella 150 · N° ABC123 · Rojo" (todo opcional).
 *  `Rodado`/`Cilindrada`/`Patente` solo aplican según el tipo (ver EQUIPMENT_ATTR_LABEL):
 *  en un celular o una PC el campo es un dato libre sin prefijo. */
export function equipmentLabel(e: Equipment | null | undefined): string {
  if (!e) return "";
  const head = [e.brand, e.model].filter(Boolean).join(" ");
  const attr = e.rodado
    ? e.kind && e.kind !== "bici"
      ? e.rodado
      : `${EQUIPMENT_ATTR_LABEL[e.kind || "bici"] || "Rodado"} ${e.rodado}`
    : null;
  const bits = [head || null, attr, e.identifier ? `N° ${e.identifier}` : null, e.color].filter(Boolean);
  const label = bits.join(" · ");
  return label || (e.id ? "Equipo sin ficha de datos" : "");
}

/** Fila de `bookings` (la API devuelve el equipo con prefijo `equipment_*`). */
export type EquipmentBooking = {
  equipment_id?: string | null;
  equipment_brand?: string | null;
  equipment_model?: string | null;
  equipment_rodado?: string | null;
  equipment_identifier?: string | null;
  equipment_color?: string | null;
  equipment_notes?: string | null;
  declared_issue?: string | null;
  product_name?: string | null;
  product_label?: string | null;
};

/**
 * Equipo de una fila de booking/orden. `equipmentLabel` espera los campos sin
 * prefijo, así que hay que mapearlos: pasarle la fila directa devolvía siempre
 * "Equipo sin ficha de datos" (leía `brand` inexistente y `id` = id del turno).
 */
export function equipmentFromBooking(b: EquipmentBooking | null | undefined): Equipment {
  return {
    id: b?.equipment_id ?? "",
    brand: b?.equipment_brand ?? null,
    model: b?.equipment_model ?? null,
    rodado: b?.equipment_rodado ?? null,
    identifier: b?.equipment_identifier ?? null,
    color: b?.equipment_color ?? null,
    notes: b?.equipment_notes ?? null,
    photo_url: undefined,
  };
}

/** Etiqueta del equipo de una orden ("" si no hay equipo con datos). */
export function orderEquipmentLabel(b: EquipmentBooking | null | undefined): string {
  return equipmentLabel(equipmentFromBooking(b));
}

/**
 * Asunto de una orden para LISTADOS (tablero, "En el taller", tira):
 * el equipo si tiene ficha, y si no, lo que el cliente vino a hacer
 * (falla declarada) — "cambio de cadena", no "Equipo sin ficha de datos".
 */
export function orderSubjectLabel(b: EquipmentBooking | null | undefined): string {
  const eq = orderEquipmentLabel(b);
  if (eq && eq !== "Equipo sin ficha de datos") return eq;
  const issue = String(b?.declared_issue || "").trim();
  if (issue) return issue;
  const product = String(b?.product_name || b?.product_label || "").trim();
  if (product) return product;
  return "Sin ficha";
}

/** ¿Hay algo que valga para crear/asociar un equipo? (marca/modelo o serie). */
export function equipmentHasContent(e: Pick<Equipment, "brand" | "model" | "identifier" | "rodado" | "color"> | null | undefined): boolean {
  if (!e) return false;
  return [e.brand, e.model, e.identifier, e.rodado, e.color].some((v) => String(v || "").trim() !== "");
}

/** Nombre visible de cada tipo ("Bicicleta", "Moto", "Celular"...). */
export function equipmentKindLabel(kind: string | null | undefined): string {
  switch (kind) {
    case "bici":
      return "Bicicleta";
    case "moto":
      return "Moto";
    case "automotor":
      return "Auto";
    case "electro":
      return "Electrodoméstico";
    case "celular":
      return "Celular";
    case "pc":
      return "PC / Notebook";
    case "otro":
      return "Equipo";
    default:
      // Sin tipo cargado ya no se asume bici: el vertical sirve para
      // cualquier taller (moto, auto, electro, celular, PC...).
      return "Equipo";
  }
}

/** Prefijo del segundo dato de la ficha (rodado del campo `rodado`) por tipo. */
const EQUIPMENT_ATTR_LABEL: Partial<Record<EquipmentKind, string>> = {
  bici: "Rodado",
  moto: "Cilindrada",
  automotor: "Patente",
};

/** Etiqueta del segundo dato para formularios (placeholder). */
export function equipmentAttrLabel(kind: string | null | undefined): string {
  return EQUIPMENT_ATTR_LABEL[(kind || "bici") as EquipmentKind] || "Medida / detalle";
}

/**
 * Ejemplos de marca/modelo para los placeholders, por tipo: un formulario
 * genérico con "Scott/XT" confunde en un service de celulares o PC.
 */
export function equipmentFieldExamples(kind: string | null | undefined): { brand: string; model: string } {
  switch (kind) {
    case "moto":
      return { brand: "Zanella", model: "150" };
    case "automotor":
      return { brand: "Ford", model: "Focus" };
    case "electro":
      return { brand: "Philco", model: "Lavarropas" };
    case "celular":
      return { brand: "Samsung", model: "A55" };
    case "pc":
      return { brand: "HP", model: "Pavilion" };
    case "bici":
      return { brand: "Scott", model: "XT" };
    default:
      return { brand: "Marca", model: "Modelo" };
  }
}

/** Emoji representativo del tipo (etiqueta térmica, recordatorios). */
export function equipmentEmoji(kind: string | null | undefined): string {
  switch (kind) {
    case "moto":
      return "🏍️";
    case "automotor":
      return "🚗";
    case "electro":
      return "🔌";
    case "celular":
      return "📱";
    case "pc":
      return "💻";
    case "bici":
      return "🚲";
    default:
      return "🛠️";
  }
}

/**
 * Tipo de equipo sugerido según el rubro (categoría) del comercio: una
 * bicicletería crea bicis, una gomería motos, un service de celulares celulares.
 * Tolera textos varios ("Bicicletería", "bici", "SERVICIO TECNICO CELULARES"...).
 */
export function inferEquipmentKind(category: unknown): EquipmentKind {
  const cat = String(category || "");
  if (/bici|cycl|bicicle/i.test(cat)) return "bici";
  if (/moto|gomer/i.test(cat)) return "moto";
  if (/auto|automotor|mecánic|mecanic|chapa|pintura/i.test(cat)) return "automotor";
  if (/celular|móvil|movil|smartphone|tablet/i.test(cat)) return "celular";
  if (/\bpc\b|comput|inform|notebook|macbook/i.test(cat)) return "pc";
  if (/electrodom|helader|lavar|cocina|microondas|televisor/i.test(cat)) return "electro";
  return "otro";
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
  return `Hola ${name}! Te escribe ${storeName} ${equipmentEmoji(equipment.kind)} Tenemos tu ${eqLabel} registrada.${ago} ¿Querés que te anotemos para el próximo service?`;
}
