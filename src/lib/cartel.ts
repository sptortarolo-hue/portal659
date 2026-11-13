/**
 * Motor del cartel imprimible con QR (stickers de mesa / vidriera).
 *
 * Este módulo es 100% client-safe y SIN imports a propósito: lo usan
 *  - la página /vendor/carta-qr (preview en el navegador + impresión),
 *  - la ruta /api/vendor/cartel/[slug] (PNG y PDF con satori),
 *  - scripts/check-cartel.ts (verificación sin build).
 *
 * La paleta se espeja de VERTICALS (src/lib/config.ts); el check script
 * falla si alguien cambia un color de un lado y no del otro.
 */

export type CartelTarget = "carta" | "tienda";
export type CartelTemplate = "colorido" | "foto" | "minimal";
export type CartelSize = "a4" | "a5" | "sticker" | "hoja2x2";

/* ------------------------------------------------------------------ */
/* Destino del QR                                                     */
/* ------------------------------------------------------------------ */

/** Verticales de servicios: su cartel va al micrositio (turnos/presupuestos). */
export const CARTEL_SERVICE_VERTICALS = ["servicio", "estetica", "taller", "salud"] as const;

export function isCartelServiceVertical(vertical?: string | null): boolean {
  return !!vertical && (CARTEL_SERVICE_VERTICALS as readonly string[]).includes(vertical);
}

/**
 * Destino efectivo del QR: lo que eligió el comercio; si nunca eligió,
 * se resuelve automático (servicios → micrositio, resto → carta de mesa).
 */
export function cartelTarget(
  vertical: string | null | undefined,
  stored: string | null | undefined
): CartelTarget {
  if (stored === "tienda" || stored === "carta") return stored;
  return isCartelServiceVertical(vertical) ? "tienda" : "carta";
}

/** URL a la que apunta el QR del cartel. */
export function cartelTargetUrl(slug: string, target: CartelTarget, siteUrl: string): string {
  const base = (siteUrl || "").replace(/\/$/, "");
  return target === "tienda" ? `${base}/tienda/${slug}` : `${base}/carta/${slug}`;
}

/* ------------------------------------------------------------------ */
/* Paleta por rubro                                                    */
/* ------------------------------------------------------------------ */

export type CartelPalette = {
  hex: string;
  dark: string;
  name: string;
  emoji: string;
};

/** Mismos hex/emoji que VERTICALS en src/lib/config.ts. */
export const CARTEL_PALETTE: Record<string, CartelPalette> = {
  gastronomia: { hex: "#ff6b4a", dark: "#b93a1d", name: "Gastronomía", emoji: "🍽️" },
  comercio: { hex: "#10b981", dark: "#047857", name: "Comercio del Barrio", emoji: "🏪" },
  servicio: { hex: "#0ea5e9", dark: "#0369a1", name: "Servicios", emoji: "🔧" },
  moda: { hex: "#8b5cf6", dark: "#5b21b6", name: "Ropa y Accesorios", emoji: "👗" },
  salud: { hex: "#ec4899", dark: "#9d174d", name: "Salud y Bienestar", emoji: "🧘" },
  estetica: { hex: "#f472b6", dark: "#be185d", name: "Peluquería y Estética", emoji: "💇" },
  taller: { hex: "#f97316", dark: "#9a3412", name: "Talleres y Reparaciones", emoji: "🛠️" },
  otro: { hex: "#2563eb", dark: "#1e3a8a", name: "Comercio", emoji: "🏪" },
};

export function cartelPalette(vertical?: string | null): CartelPalette {
  return CARTEL_PALETTE[vertical || ""] || CARTEL_PALETTE.otro;
}

/* ------------------------------------------------------------------ */
/* Copy por rubro + destino                                           */
/* ------------------------------------------------------------------ */

export type CartelStep = { full: string; short: string };

export type CartelCopy = {
  title: string;
  subtitle: string;
  steps: [CartelStep, CartelStep, CartelStep];
  badge: string | null;
};

const step = (full: string, short: string): CartelStep => ({ full, short });

const CARTEL_COPY: Record<string, Record<CartelTarget, CartelCopy>> = {
  gastronomia: {
    carta: {
      title: "Escaneá y mirá la carta",
      subtitle: "El menú completo, siempre actualizado",
      steps: [step("Escaneá con la cámara", "Escaneá"), step("Mirá el menú", "Mirá"), step("Pedí al mesero", "Pedí")],
      badge: "El mesero te toma el pedido",
    },
    tienda: {
      title: "Escaneá y pedí online",
      subtitle: "Armá tu pedido y pagá sin hacer fila",
      steps: [step("Escaneá con la cámara", "Escaneá"), step("Armá tu pedido", "Armá"), step("Pagá online", "Pagá")],
      badge: "0% comisión",
    },
  },
  comercio: {
    carta: {
      title: "Escaneá y mirá el catálogo",
      subtitle: "Nuestros productos, siempre actualizados",
      steps: [step("Escaneá", "Escaneá"), step("Mirá el catálogo", "Mirá"), step("Pedí por WhatsApp", "Pedí")],
      badge: null,
    },
    tienda: {
      title: "Escaneá y mirá el catálogo",
      subtitle: "Elegí tus productos y te los llevamos o retirás",
      steps: [step("Escaneá", "Escaneá"), step("Elegí tus productos", "Elegí"), step("Pedí por WhatsApp", "Pedí")],
      badge: "0% comisión",
    },
  },
  moda: {
    carta: {
      title: "Escaneá y mirá el catálogo",
      subtitle: "Talles, colores y stock al día",
      steps: [step("Escaneá", "Escaneá"), step("Mirá el catálogo", "Mirá"), step("Consultá por WhatsApp", "Consultá")],
      badge: null,
    },
    tienda: {
      title: "Escaneá y pedí online",
      subtitle: "Talles, colores y stock al día",
      steps: [step("Escaneá", "Escaneá"), step("Elegí talle y color", "Elegí"), step("Pedí online", "Pedí")],
      badge: "0% comisión",
    },
  },
  servicio: {
    carta: {
      title: "Escaneá y pedí un presupuesto",
      subtitle: "Contanos qué necesitás y te pasamos el precio",
      steps: [step("Escaneá", "Escaneá"), step("Contanos qué necesitás", "Contanos"), step("Te pasamos el precio", "Presupuesto")],
      badge: "Sin compromiso",
    },
    tienda: {
      title: "Escaneá y pedí un presupuesto",
      subtitle: "Contanos qué necesitás y te pasamos el precio",
      steps: [step("Escaneá", "Escaneá"), step("Contanos qué necesitás", "Contanos"), step("Te pasamos el precio", "Presupuesto")],
      badge: "Sin compromiso",
    },
  },
  estetica: {
    carta: {
      title: "Escaneá y reservá tu turno",
      subtitle: "Elegí servicio, profesional y horario",
      steps: [step("Escaneá", "Escaneá"), step("Elegí servicio y profesional", "Elegí"), step("Reservá tu turno", "Reservá")],
      badge: "Reservá online",
    },
    tienda: {
      title: "Escaneá y reservá tu turno",
      subtitle: "Elegí servicio, profesional y horario",
      steps: [step("Escaneá", "Escaneá"), step("Elegí servicio y profesional", "Elegí"), step("Reservá tu turno", "Reservá")],
      badge: "Reservá online",
    },
  },
  taller: {
    carta: {
      title: "Escaneá y traé tu equipo",
      subtitle: "Contanos qué pasa y te pasamos el presupuesto",
      steps: [step("Escaneá", "Escaneá"), step("Contanos qué pasa", "Contanos"), step("Recibí el presupuesto", "Presupuesto")],
      badge: "Sin compromiso",
    },
    tienda: {
      title: "Escaneá y traé tu equipo",
      subtitle: "Contanos qué pasa y te pasamos el presupuesto",
      steps: [step("Escaneá", "Escaneá"), step("Contanos qué pasa", "Contanos"), step("Recibí el presupuesto", "Presupuesto")],
      badge: "Sin compromiso",
    },
  },
  salud: {
    carta: {
      title: "Escaneá y reservá tu turno",
      subtitle: "Elegí tu práctica y tu horario",
      steps: [step("Escaneá", "Escaneá"), step("Elegí tu práctica", "Elegí"), step("Reservá tu turno", "Reservá")],
      badge: "Reservá online",
    },
    tienda: {
      title: "Escaneá y reservá tu turno",
      subtitle: "Elegí tu práctica y tu horario",
      steps: [step("Escaneá", "Escaneá"), step("Elegí tu práctica", "Elegí"), step("Reservá tu turno", "Reservá")],
      badge: "Reservá online",
    },
  },
  otro: {
    carta: {
      title: "Escaneá y mirá la carta",
      subtitle: "Siempre actualizado",
      steps: [step("Escaneá", "Escaneá"), step("Mirá la carta", "Mirá"), step("Pedí por WhatsApp", "Pedí")],
      badge: null,
    },
    tienda: {
      title: "Escaneá y pedí online",
      subtitle: "Siempre actualizado",
      steps: [step("Escaneá", "Escaneá"), step("Elegí y armá tu pedido", "Elegí"), step("Pedí online", "Pedí")],
      badge: "0% comisión",
    },
  },
};

export function cartelCopy(vertical: string | null | undefined, target: CartelTarget): CartelCopy {
  const byVertical = CARTEL_COPY[vertical || ""] || CARTEL_COPY.otro;
  return byVertical[target] || byVertical.carta;
}

/* ------------------------------------------------------------------ */
/* Tamaños                                                            */
/* ------------------------------------------------------------------ */

export type CartelSizeSpec = {
  id: CartelSize;
  label: string;
  hint: string;
  /** Página en milímetros (la hoja que sale de la impresora). */
  pageWmm: number;
  pageHmm: number;
  /** PNG a 150 dpi. */
  pxW: number;
  pxH: number;
  /** Versión compacta (menos texto) para stickers chicos. */
  compact: boolean;
  /** Si es hoja con varias copias (2×2 = 4 stickers en A4). */
  sheet?: { cols: number; rows: number };
};

export const CARTEL_SIZES: CartelSizeSpec[] = [
  {
    id: "a4",
    label: "A4",
    hint: "Cartel para la pared o el mostrador",
    pageWmm: 210,
    pageHmm: 297,
    pxW: 1240,
    pxH: 1754,
    compact: false,
  },
  {
    id: "a5",
    label: "A5",
    hint: "Media hoja (mesa / mesón)",
    pageWmm: 148,
    pageHmm: 210,
    pxW: 874,
    pxH: 1240,
    compact: false,
  },
  {
    id: "sticker",
    label: "10×15",
    hint: "Sticker photo (imprenta)",
    pageWmm: 100,
    pageHmm: 150,
    pxW: 591,
    pxH: 886,
    compact: true,
  },
  {
    id: "hoja2x2",
    label: "2×2",
    hint: "4 stickers en una hoja A4",
    pageWmm: 210,
    pageHmm: 297,
    pxW: 1240,
    pxH: 1754,
    compact: true,
    sheet: { cols: 2, rows: 2 },
  },
];

export function cartelSize(id: string | null | undefined): CartelSizeSpec {
  return CARTEL_SIZES.find((s) => s.id === id) || CARTEL_SIZES[0];
}

/* ------------------------------------------------------------------ */
/* QR                                                                  */
/* ------------------------------------------------------------------ */

/** Opciones del QR del cartel: quiet zone amplia + corrección de errores alta. */
export const CARTEL_QR = {
  margin: 3,
  errorCorrectionLevel: "H",
  width: 1200,
} as const;

/* ------------------------------------------------------------------ */
/* Datos del local (pie del cartel)                                    */
/* ------------------------------------------------------------------ */

const DAY_ABBR: Record<string, string> = {
  lun: "Lun", lunes: "Lun",
  mar: "Mar", martes: "Mar",
  mie: "Mié", miercoles: "Mié",
  jue: "Jue", jueves: "Jue",
  vie: "Vie", viernes: "Vie",
  sab: "Sáb", sabado: "Sáb",
  dom: "Dom", domingo: "Dom",
};

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function fmtTime(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] || "00";
  const suffix = m[3]?.toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

/**
 * Resumen de horarios para el cartel: "Lun–Sáb 09:00–18:00 · Dom Cerrado".
 * Tolera el formato del editor ("lun: 09:00-18:00, mar: 09:00-18:00") y
 * devuelve el texto crudo (acotado) si no lo reconoce.
 */
export function cartelHoursSummary(hours: string | null | undefined): string | null {
  const raw = (hours || "").trim();
  if (!raw) return null;
  if (/\b24\s*(hs|horas|\/7)\b/i.test(raw) || /^24\s*hs?$/i.test(raw)) return "Abierto 24 hs";

  const parts = raw.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  const groups = new Map<string, string[]>();
  let matched = 0;

  for (const part of parts) {
    const m = part.match(/^([a-záéíóúñ]+)\s*:\s*(.+)$/i);
    if (!m) continue;
    const day = DAY_ABBR[norm(m[1])];
    if (!day) continue;
    const rest = m[2].trim();
    if (/cerrado|n\/a/i.test(rest)) {
      const key = "Cerrado";
      groups.set(key, [...(groups.get(key) || []), day]);
      matched++;
      continue;
    }
    const range = rest.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:[-–]|\ba\b)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (!range) continue;
    const from = fmtTime(range[1]);
    const to = fmtTime(range[2]);
    if (!from || !to) continue;
    const key = `${from}–${to}`;
    groups.set(key, [...(groups.get(key) || []), day]);
    matched++;
  }

  if (matched === 0) return raw.length > 60 ? `${raw.slice(0, 57)}…` : raw;

  const chunks: string[] = [];
  for (const [time, days] of groups) {
    const unique = Array.from(new Set(days));
    const label =
      unique.length === 1
        ? unique[0]
        : `${unique[0]}–${unique[unique.length - 1]}`;
    chunks.push(`${label} ${time}`);
  }
  return chunks.join(" · ");
}

/** "3456-7890" → "+54 9 3456-7890" (formato simple, sin lib). */
export function cartelPhone(raw: string | null | undefined): string | null {
  const digits = (raw || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  if (digits.startsWith("54")) {
    const rest = digits.slice(2);
    return `+54 ${rest.slice(0, 2)} ${rest.slice(2, 6)}-${rest.slice(6)}`.trim();
  }
  if (digits.length === 10) return `+54 9 ${digits.slice(0, 2)} ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw || null;
}

/** Rubro visible ("peluquería" → "Peluquería"); null si es genérico. */
export function cartelRubro(category: string | null | undefined): string | null {
  const c = (category || "").trim();
  if (!c) return null;
  if (["otro", "otra", "otros", "otras"].includes(c.toLowerCase())) return null;
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Dominio corto para el pie del cartel ("portal659.com.ar"). */
export function cartelDomain(siteUrl: string): string {
  return (siteUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}
