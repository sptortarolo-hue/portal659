/**
 * Etiquetas adhesivas (productos por unidad y pesables) — especificación
 * única de dibujo.
 *
 * Este archivo NO dibuja nada: arma una lista de operaciones (`LabelOp`) con
 * coordenadas ya resueltas. Los dos renderers — canvas en el navegador
 * (`label-render.ts`, preview en vivo) y pureimage/sharp en el servidor
 * (`label-render-server.ts`, lo que realmente se imprime) — recorren la MISMA
 * lista. Por eso el preview y el papel coinciden por construcción: no hay dos
 * layouts que se puedan desincronizar.
 *
 * Autocontenido a propósito (sin imports ni alias `@/`): lo corre Node directo
 * desde `scripts/check-label-spec.mjs`. Las tablas de CODE128 están duplicadas
 * de `src/lib/code128.ts` por la misma razón que en `scale-barcode.ts`; si se
 * toca una, el check avisa.
 *
 * Unidades: 203 dpi = 8 px/mm (mismo motor que la Elitronic PL-500).
 */

// ── Tamaños ─────────────────────────────────────────────────────────────────

export const LABEL_PX_PER_MM = 8;
/** Ancho imprimible máximo del cabezal (76 mm en la PL-500). */
export const LABEL_MAX_WIDTH_MM = 76;
/** Alias legible para la UI. */
export const LABEL_SIZE_MAX_MM = LABEL_MAX_WIDTH_MM;
export const LABEL_MIN_WIDTH_MM = 25;
export const LABEL_MAX_HEIGHT_MM = 150;
export const LABEL_MIN_HEIGHT_MM = 15;

export type LabelSizeId = "50x30" | "40x30" | "58x40" | "custom";

export const LABEL_PRESETS: Record<Exclude<LabelSizeId, "custom">, { widthMm: number; heightMm: number; label: string }> = {
  "40x30": { widthMm: 40, heightMm: 30, label: "40 × 30 mm (almacén)" },
  "50x30": { widthMm: 50, heightMm: 30, label: "50 × 30 mm (recomendada)" },
  "58x40": { widthMm: 58, heightMm: 40, label: "58 × 40 mm (con datos legales)" },
};

export type LabelTemplateId = "envasado" | "gondola";

export const LABEL_TEMPLATES: Record<LabelTemplateId, { label: string; hint: string }> = {
  envasado: {
    label: "Envasado (pesable)",
    hint: "Va pegada al producto: peso, $/kg, total, envasado y vencimiento.",
  },
  gondola: {
    label: "Góndola (precio)",
    hint: "Va en la repisa: nombre, precio grande y precio por unidad de medida.",
  },
};

export type LabelLanguage = "auto" | "tspl" | "zpl" | "escpos";

export const LABEL_LANGUAGES: Record<LabelLanguage, { label: string; hint: string }> = {
  auto: { label: "Automático (prueba y elige)", hint: "Imprime en el lenguaje que ya funcionó en este equipo." },
  tspl: { label: "TSPL / TSPL2", hint: "El más común en impresoras de etiquetas (Zebra, Xprinter, Elitronic)." },
  zpl: { label: "ZPL II", hint: "Zebra y compatibles." },
  escpos: { label: "ESC/POS", hint: "Impresoras que solo entienden comandos de ticket." },
};

// ── Configuración (jsonb del comercio) ──────────────────────────────────────

export type LabelPrinterConfig = {
  enabled: boolean;
  language: LabelLanguage;
  size: LabelSizeId;
  widthMm: number;
  heightMm: number;
  tpl: LabelTemplateId;
  /** Cola USB del agente de este equipo (vacío = la del agente). */
  usbName: string;
  /** Hueco (gap) entre etiquetas del rollo, en mm. Default 2. */
  gapMm: number;
  /** Invertir colores (negativo). Para impresoras que imprimen al revés. */
  invert: boolean;
  /** Imprimir solo al estabilizar el peso (apagado por defecto). */
  autoPrint: boolean;
  /** Días de vida útil sugeridos para el vencimiento (null = no sugerir). */
  shelfLifeDays: number | null;
};

export const DEFAULT_LABEL_PRINTER_CONFIG: LabelPrinterConfig = {
  enabled: false,
  language: "auto",
  size: "50x30",
  widthMm: 50,
  heightMm: 30,
  tpl: "envasado",
  usbName: "",
  gapMm: 2,
  invert: false,
  autoPrint: false,
  shelfLifeDays: null,
};

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Lee la config tolerante: jsonb ausente, texto o basura → default. Nunca lanza. */
export function readLabelPrinterConfig(raw: unknown): LabelPrinterConfig {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const size: LabelSizeId =
    src.size === "40x30" || src.size === "58x40" || src.size === "custom" || src.size === "50x30"
      ? src.size
      : DEFAULT_LABEL_PRINTER_CONFIG.size;
  const preset = size === "custom" ? null : LABEL_PRESETS[size];
  const language: LabelLanguage =
    src.language === "tspl" || src.language === "zpl" || src.language === "escpos" || src.language === "auto"
      ? src.language
      : DEFAULT_LABEL_PRINTER_CONFIG.language;
  const tpl: LabelTemplateId = src.tpl === "gondola" ? "gondola" : "envasado";
  const shelf = Number(src.shelfLifeDays);
  return {
    enabled: src.enabled === true,
    language,
    size,
    widthMm: Math.round(
      clampNum(preset ? preset.widthMm : src.widthMm, LABEL_MIN_WIDTH_MM, LABEL_MAX_WIDTH_MM, 50) * 10
    ) / 10,
    heightMm: Math.round(
      clampNum(preset ? preset.heightMm : src.heightMm, LABEL_MIN_HEIGHT_MM, LABEL_MAX_HEIGHT_MM, 30) * 10
    ) / 10,
    tpl,
    usbName: String(src.usbName ?? "").trim().slice(0, 120),
    gapMm: Math.round(clampNum(src.gapMm, 1, 10, 2) * 10) / 10,
    invert: src.invert === true,
    autoPrint: src.autoPrint === true,
    shelfLifeDays:
      Number.isFinite(shelf) && shelf > 0 ? Math.min(365, Math.round(shelf)) : null,
  };
}

/** Tamaño en píxeles (203 dpi) a partir de la config. */
export function labelPixelSize(cfg: LabelPrinterConfig): { widthPx: number; heightPx: number } {
  const widthMm = clampNum(cfg.widthMm, LABEL_MIN_WIDTH_MM, LABEL_MAX_WIDTH_MM, 50);
  const heightMm = clampNum(cfg.heightMm, LABEL_MIN_HEIGHT_MM, LABEL_MAX_HEIGHT_MM, 30);
  return {
    widthPx: Math.round(widthMm * LABEL_PX_PER_MM),
    heightPx: Math.round(heightMm * LABEL_PX_PER_MM),
  };
}

export function labelSizeLabel(cfg: LabelPrinterConfig): string {
  return `${cfg.widthMm} × ${cfg.heightMm} mm`;
}

// ── Formato (plata, kilos y fechas) ─────────────────────────────────────────

function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "$ 9.000,00" — formateo manual para que navegador y server den igual. */
export function fmtMoney(n: number | null | undefined, decimals = 2): string {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const neg = safe < 0;
  const fixed = Math.abs(safe).toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const out = groupThousands(intPart) + (decPart ? "," + decPart : "");
  return `${neg ? "-" : ""}$${out}`;
}

/** "$ 12.000" (sin centavos cuando son .00) — para la góndola. */
export function fmtPriceShort(n: number | null | undefined): string {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  const isInt = Math.abs(safe - Math.round(safe)) < 0.005;
  return fmtMoney(safe, isInt ? 0 : 2);
}

/** "0,750 kg" */
export function fmtKg(kg: number | null | undefined): string {
  const n = Number(kg);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(3).replace(".", ",")} kg`;
}

/** "17/11/26" a partir de "YYYY-MM-DD". */
export function fmtDateShort(iso: string | null | undefined): string {
  const s = String(iso ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

/** Fecha de hoy en hora Argentina (el server corre en UTC). */
export function arISODate(now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Suma días a un "YYYY-MM-DD" y devuelve el mismo formato. */
export function addDaysISO(iso: string, days: number): string | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

// ── Métrica de texto determinística ─────────────────────────────────────────
//
// El ancho de cada glifo se estima con una tabla de anchos relativos (em) de
// una sans bold. No se usa `measureText` porque sería distinto en canvas y en
// pureimage, y el recorte/wrap podría diferir entre el preview y el papel.

function emWidth(ch: string): number {
  if (ch === " ") return 0.26;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[.,:;'’`]/.test(ch)) return 0.26;
  if (/[/\\|!¡()[\]]/.test(ch)) return 0.34;
  if (/[-–—]/.test(ch)) return 0.36;
  if (/[MW]/.test(ch)) return 0.88;
  if (/[mw]/.test(ch)) return 0.86;
  if (/[ilIÍ]/.test(ch)) return 0.28;
  if (/[fjrt]/.test(ch)) return 0.37;
  if (/[A-ZÁÉÍÓÚÑ]/.test(ch)) return 0.68;
  if (/[a-záéíóúñ]/.test(ch)) return 0.55;
  if (ch === "$") return 0.56;
  if (ch === "%") return 0.86;
  return 0.6;
}

/** Ancho estimado del texto en píxeles (con 3% de colchón). */
export function measureTextPx(text: string, sizePx: number): number {
  let em = 0;
  for (const ch of String(text ?? "")) em += emWidth(ch);
  return em * sizePx * 1.03;
}

function truncateToWidth(text: string, sizePx: number, maxWidth: number): string {
  const s = String(text ?? "").trim();
  if (!s) return "";
  if (measureTextPx(s, sizePx) <= maxWidth) return s;
  let out = "";
  for (const ch of s) {
    if (measureTextPx(out + ch + "…", sizePx) > maxWidth) break;
    out += ch;
  }
  return (out || s.slice(0, 1)) + "…";
}

/** Envuelve en líneas; si sobran, corta la última con "…". */
export function wrapText(text: string, sizePx: number, maxWidth: number, maxLines: number): string[] {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (measureTextPx(probe, sizePx) <= maxWidth) {
      current = probe;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    // Palabra sola más ancha que la etiqueta: corte duro.
    while (measureTextPx(current, sizePx) > maxWidth && current.length > 1) {
      let cut = current.length - 1;
      while (cut > 1 && measureTextPx(current.slice(0, cut), sizePx) > maxWidth) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = truncateToWidth(kept[maxLines - 1], sizePx, maxWidth);
  return kept;
}

// ── Operaciones de dibujo ───────────────────────────────────────────────────

export type LabelOp =
  | { kind: "text"; text: string; x: number; y: number; size: number; bold?: boolean }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  /** Bloque negro con texto blanco (badge "PROMO", "OFERTA"). */
  | { kind: "chip"; text: string; x: number; y: number; size: number; h: number; padX: number }
  /** Código de barras: anchos alternados barra/espacio (empieza en barra). */
  | { kind: "bars"; runs: number[]; x: number; y: number; module: number; h: number };

export type LabelContent = {
  template: LabelTemplateId;
  storeName: string;
  productName: string;
  brand?: string | null;
  /** PLU de balanza (solo pesables). */
  plu?: string | null;
  unit: "unidad" | "kg";
  /** Precio de venta vigente (con promo aplicada). Para kg = precio por kg. */
  price: number;
  /** Precio de lista, si hay promo. */
  oldPrice?: number | null;
  /** Kilos pesados (solo pesables). */
  kg?: number | null;
  /** Total a pagar: kg × precio o el precio de la unidad. */
  total: number;
  packedAt?: string | null;
  expiresAt?: string | null;
  /** Código legible a imprimir bajo las barras (si no se puede codificar). */
  code?: string | null;
};

export type LabelSpec = {
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
  ops: LabelOp[];
  /** Avisos para el panel (ej. "el código no entra: se imprime solo el número"). */
  warnings: string[];
  /** Qué se codificó al final. */
  barcode: { symbology: "ean13" | "code128" | "none"; digits: string; module: number };
};

// ── Códigos de barras ───────────────────────────────────────────────────────

const CODE128_PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "233111",
];

const CODE128_STOP_WIDTHS = [2, 3, 3, 1, 1, 1, 2];

/** Módulos CODE128 como anchos alternados (barra/espacio). */
export function code128Runs(text: string): number[] | null {
  const clean = String(text ?? "")
    .split("")
    .map((ch) => (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126 ? ch : "?"))
    .join("")
    .trim();
  if (!clean) return null;
  const digitsOnly = /^\d+$/.test(clean);
  const values: number[] = [];
  if (digitsOnly && clean.length >= 4 && clean.length % 2 === 0) {
    values.push(105);
    for (let i = 0; i < clean.length; i += 2) values.push(Number(clean.slice(i, i + 2)));
  } else if (digitsOnly && clean.length >= 5) {
    values.push(104, clean.charCodeAt(0) - 32, 99);
    for (let i = 1; i < clean.length; i += 2) values.push(Number(clean.slice(i, i + 2)));
  } else {
    values.push(104);
    for (const ch of clean) values.push(ch.charCodeAt(0) - 32);
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += i * values[i];
  values.push(sum % 103);
  const runs: number[] = [];
  for (const v of values) for (const ch of CODE128_PATTERNS[v]) runs.push(Number(ch));
  runs.push(...CODE128_STOP_WIDTHS);
  return runs;
}

export function code128ModuleCount(text: string): number | null {
  const runs = code128Runs(text);
  if (!runs) return null;
  return runs.reduce((s, w) => s + w, 0);
}

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** EAN-13 → anchos alternados (barra/espacio) del área útil (95 módulos). */
export function ean13Runs(digits: string): number[] | null {
  const d = String(digits ?? "").replace(/\D+/g, "");
  if (d.length !== 13) return null;
  const parity = EAN_PARITY[Number(d[0])];
  if (!parity) return null;
  let modules = "101"; // guard izquierdo
  for (let i = 0; i < 6; i++) {
    const n = Number(d[i + 1]);
    modules += parity[i] === "L" ? EAN_L[n] : EAN_G[n];
  }
  modules += "01010"; // guard central
  for (let i = 0; i < 6; i++) modules += EAN_R[Number(d[7 + i])];
  modules += "101"; // guard derecho
  if (modules.length !== 95) return null;
  const runs: number[] = [];
  let current = modules[0];
  let count = 0;
  for (const m of modules) {
    if (m === current) {
      count++;
    } else {
      runs.push(count);
      current = m;
      count = 1;
    }
  }
  runs.push(count);
  return runs;
}

export function ean13ModuleCount(digits: string): number | null {
  const runs = ean13Runs(digits);
  if (!runs) return null;
  return runs.reduce((s, w) => s + w, 0);
}

/** Dígito verificador GS1 (mod 10). */
export function gtinCheckDigit(body: string): number | null {
  const digits = String(body ?? "").replace(/\D+/g, "");
  if (digits.length < 2) return null;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

export type ScaleLabelFormat = {
  prefix: string;
  pluDigits: number;
  valueDigits: number;
  valueKind: "peso_g" | "peso_kg" | "importe";
  decimals: number;
  checkDigit: "validar" | "ignorar" | "ninguno";
};

/**
 * Arma los 13 dígitos que lee el Mostrador (el MISMO formato que configura la
 * sección "Etiquetas con lector"). Devuelve null si la config no da 13 dígitos
 * (en ese caso se imprime CODE128 con lo que haya).
 *
 * El importe se recalcula con el precio del día: la etiqueta impresa es
 * informativa, igual que una etiqueta de balanza.
 */
export function buildScaleLabelDigits(
  input: { plu: string; kg?: number | null; amount?: number | null },
  cfg: ScaleLabelFormat
): string | null {
  const plu = String(input.plu ?? "").replace(/\D+/g, "");
  if (!plu) return null;
  const pluPadded = plu.padStart(cfg.pluDigits, "0");
  if (pluPadded.length !== cfg.pluDigits) return null;

  let scaled = 0;
  if (cfg.valueKind === "importe") {
    // El importe va con sus decimales implícitos (ej: 2 decimales → $1234.50 → 123450).
    scaled = Math.round((Number(input.amount) || 0) * Math.pow(10, cfg.decimals));
  } else if (cfg.valueKind === "peso_g") {
    // peso_g: el valor va en gramos, los decimales se aplican igual.
    scaled = Math.round((Number(input.kg) || 0) * 1000 * Math.pow(10, cfg.decimals));
  } else {
    scaled = Math.round((Number(input.kg) || 0) * Math.pow(10, cfg.decimals));
  }
  if (!(scaled > 0)) return null;
  const valueStr = String(scaled).padStart(cfg.valueDigits, "0");
  if (valueStr.length > cfg.valueDigits) return null;

  const body = `${cfg.prefix}${pluPadded}${valueStr}`;
  if (body.length !== 12) return null;
  const dv = gtinCheckDigit(body);
  if (dv == null) return null;
  return `${body}${dv}`;
}

// ── Layout ──────────────────────────────────────────────────────────────────

function textOp(text: string, x: number, y: number, size: number, bold = true): LabelOp | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  return { kind: "text", text: t, x: Math.round(x), y: Math.round(y), size: Math.round(size), bold };
}

/** Agrega un texto alineado dentro del área útil. */
function aligned(
  ops: LabelOp[],
  text: string,
  align: "left" | "center" | "right",
  x0: number,
  x1: number,
  y: number,
  size: number,
  bold = true
): void {
  const t = String(text ?? "").trim();
  if (!t) return;
  const w = measureTextPx(t, size);
  const x = align === "left" ? x0 : align === "right" ? x1 - w : x0 + (x1 - x0 - w) / 2;
  const op = textOp(t, x, y, size, bold);
  if (op) ops.push(op);
}

/**
 * Resuelve el bloque de código de barras.
 * Regla: gana el símbolo que permita el módulo más grande; en empate, EAN-13
 * (es el estándar de las etiquetas de balanza). Con módulo < 2 px no se
 * imprimen barras (no se leería): queda el número legible.
 */
function resolveBarcode(params: {
  eanDigits: string | null;
  fallback: string;
  innerW: number;
}): { runs: number[] | null; module: number; symbology: "ean13" | "code128" | "none"; digits: string } {
  const candidates: { symbology: "ean13" | "code128"; runs: number[]; modules: number; quiet: number; digits: string }[] = [];
  if (params.eanDigits) {
    const runs = ean13Runs(params.eanDigits);
    if (runs) candidates.push({ symbology: "ean13", runs, modules: 95, quiet: 18, digits: params.eanDigits });
  }
  const c128 = code128Runs(params.fallback);
  if (c128) {
    candidates.push({
      symbology: "code128",
      runs: c128,
      modules: c128.reduce((s, w) => s + w, 0),
      quiet: 20,
      digits: params.fallback,
    });
  }
  let best: { runs: number[]; module: number; symbology: "ean13" | "code128"; digits: string } | null = null;
  for (const c of candidates) {
    const module = Math.floor(params.innerW / (c.modules + c.quiet));
    if (module < 2) continue;
    const capped = Math.min(4, module);
    if (!best || capped > best.module || (capped === best.module && c.symbology === "ean13")) {
      best = { runs: c.runs, module: capped, symbology: c.symbology, digits: c.digits };
    }
  }
  if (best) {
    return { runs: best.runs, module: best.module, symbology: best.symbology, digits: best.digits };
  }
  return { runs: null, module: 0, symbology: "none", digits: params.eanDigits || params.fallback };
}

function buildBarcodeBlock(params: {
  ops: LabelOp[];
  warnings: string[];
  content: LabelContent;
  scaleFmt: ScaleLabelFormat | null;
  x0: number;
  x1: number;
  y: number;
  maxHeight: number;
}): { symbology: "ean13" | "code128" | "none"; digits: string; module: number } {
  const { ops, warnings, content, x0, x1, y, maxHeight } = params;
  const innerW = x1 - x0;
  const eanDigits =
    content.template === "envasado" && content.plu && params.scaleFmt && content.kg
      ? buildScaleLabelDigits(
          { plu: content.plu, kg: content.kg, amount: content.unit === "kg" ? content.total : null },
          params.scaleFmt
        )
      : null;
  const fallback = String(content.code || content.plu || "").trim();
  const resolved = resolveBarcode({ eanDigits, fallback, innerW });

  if (!resolved.runs) {
    warnings.push("El código de barras no entra en este ancho: se imprime solo el número.");
    if (resolved.digits) {
      const size = Math.min(18, Math.round(maxHeight * 0.45));
      aligned(ops, resolved.digits, "center", x0, x1, y, size, true);
    }
    return { symbology: "none", digits: resolved.digits, module: 0 };
  }

  const digitsSize = Math.max(10, Math.round(maxHeight * 0.22));
  const digitsH = Math.round(digitsSize * 1.25);
  const barsH = Math.max(18, Math.round(maxHeight - digitsH));
  const totalW = resolved.runs.reduce((s, w) => s + w, 0) * resolved.module;
  const startX = x0 + Math.round((innerW - totalW) / 2);

  ops.push({ kind: "bars", runs: resolved.runs, x: startX, y, module: resolved.module, h: barsH });
  // El número se centra bajo las barras; EAN-13 se muestra completo (lo que
  // lee el lector del mostrador).
  aligned(ops, resolved.digits, "center", startX, startX + totalW, y + barsH + Math.round(digitsSize * 0.15), digitsSize, false);

  return { symbology: resolved.symbology, digits: resolved.digits, module: resolved.module };
}

export type BuildLabelOptions = {
  /** Config del formato de etiqueta de balanza (para los 13 dígitos). */
  scaleFormat?: ScaleLabelFormat | null;
};

/**
 * Etiqueta de ENVASADO (pesable): qué es → cuánto pesa → a cuánto el kilo →
 * cuánto sale → cuándo se envasó / vence → código.
 */
function buildEnvasado(
  content: LabelContent,
  widthPx: number,
  heightPx: number,
  opts: BuildLabelOptions
): LabelSpec {
  const ops: LabelOp[] = [];
  const warnings: string[] = [];
  const s = heightPx / 240;
  const padX = Math.max(8, Math.round(widthPx * 0.04));
  const x0 = padX;
  const x1 = widthPx - padX;
  const innerW = x1 - x0;
  let y = Math.round(5 * s);

  // 1) Encabezado del local
  const storeSize = Math.round(13 * s);
  if (content.storeName) {
    aligned(ops, truncateToWidth(content.storeName.toUpperCase(), storeSize, innerW), "left", x0, x1, y, storeSize, true);
  }
  y += Math.round(16 * s);
  ops.push({ kind: "rect", x: x0, y, w: innerW, h: Math.max(1, Math.round(s)) });
  y += Math.round(7 * s);

  // 2) Producto (hasta 2 líneas)
  const nameSize = Math.round(18 * s);
  const nameLines = wrapText(content.productName, nameSize, innerW, 2);
  const lineH = Math.round(nameSize * 1.12);
  for (const ln of nameLines) {
    aligned(ops, ln, "left", x0, x1, y, nameSize, true);
    y += lineH;
  }
  y += Math.round(3 * s);

  // 3) PLU + peso
  const metaSize = Math.round(13 * s);
  if (content.plu) aligned(ops, `PLU ${content.plu}`, "left", x0, x1, y, metaSize, false);
  if (content.kg && content.kg > 0) aligned(ops, fmtKg(content.kg), "right", x0, x1, y, metaSize, true);
  y += Math.round(16 * s);

  // 4) Precio por kilo (o "PRECIO" en productos por unidad)
  const smallSize = Math.round(11 * s);
  const priceSize = Math.round(14 * s);
  const unitLabel = content.unit === "kg" ? "PRECIO POR KG" : "PRECIO";
  aligned(ops, unitLabel, "left", x0, x1, y, smallSize, false);
  aligned(ops, fmtMoney(content.price, 2), "right", x0, x1, y - Math.round(1 * s), priceSize, true);
  y += Math.round(18 * s);

  // 5) TOTAL — el dato más grande de la etiqueta
  const totalSize = Math.round(30 * s);
  aligned(ops, "TOTAL", "left", x0, x1, y + Math.round(totalSize * 0.55), Math.round(11 * s), false);
  aligned(ops, fmtMoney(content.total, 2), "right", x0, x1, y, totalSize, true);
  y += Math.round(totalSize * 1.22);

  // 6) Fechas
  const datesSize = Math.round(11 * s);
  const packed = fmtDateShort(content.packedAt);
  const expires = fmtDateShort(content.expiresAt);
  if (packed) {
    aligned(ops, `ENV. ${packed}`, "left", x0, x1, y, datesSize, false);
  }
  if (expires) {
    aligned(ops, `VENCE ${expires}`, "right", x0, x1, y, datesSize, true);
  }
  if (packed || expires) y += Math.round(15 * s);

  // 7) Código: usa el alto que quedó
  const bottomPad = Math.round(5 * s);
  const avail = heightPx - y - bottomPad;
  const barcode =
    avail >= 26
      ? buildBarcodeBlock({
          ops,
          warnings,
          content,
          scaleFmt: opts.scaleFormat ?? null,
          x0,
          x1,
          y,
          maxHeight: avail,
        })
      : (warnings.push("No queda alto para el código de barras."),
        { symbology: "none" as const, digits: content.code || "", module: 0 });

  return {
    widthPx,
    heightPx,
    widthMm: Math.round(widthPx / LABEL_PX_PER_MM),
    heightMm: Math.round(heightPx / LABEL_PX_PER_MM),
    ops,
    warnings,
    barcode,
  };
}

/**
 * Etiqueta de GÓNDOLA: nombre + marca, precio enorme, precio por unidad de
 * medida y código interno. Sin fechas (no tienen sentido en la repisa).
 */
function buildGondola(
  content: LabelContent,
  widthPx: number,
  heightPx: number,
  opts: BuildLabelOptions
): LabelSpec {
  const ops: LabelOp[] = [];
  const warnings: string[] = [];
  const s = heightPx / 240;
  const padX = Math.max(8, Math.round(widthPx * 0.04));
  const x0 = padX;
  const x1 = widthPx - padX;
  const innerW = x1 - x0;
  let y = Math.round(6 * s);

  // Nombre (2 líneas) + marca
  const nameSize = Math.round(17 * s);
  const lines = wrapText(content.productName, nameSize, innerW, 2);
  const lineH = Math.round(nameSize * 1.1);
  for (const ln of lines) {
    aligned(ops, ln, "left", x0, x1, y, nameSize, true);
    y += lineH;
  }
  if (content.brand) {
    const brandSize = Math.round(11 * s);
    aligned(ops, truncateToWidth(content.brand, brandSize, innerW), "left", x0, x1, y, brandSize, false);
    y += Math.round(14 * s);
  }
  y += Math.round(2 * s);

  // Precio grande (con promo: precio anterior tachado en texto + chip)
  const priceSize = Math.round(38 * s);
  const hasPromo =
    content.oldPrice != null && Number(content.oldPrice) > 0 && Number(content.oldPrice) > Number(content.price) + 0.004;
  if (hasPromo) {
    const chipSize = Math.round(11 * s);
    const chipText = `ANTES ${fmtPriceShort(content.oldPrice)}`;
    ops.push({
      kind: "chip",
      text: chipText,
      x: x0,
      y,
      size: chipSize,
      h: Math.round(chipSize * 1.5),
      padX: Math.round(chipSize * 0.55),
    });
    y += Math.round(chipSize * 1.5 + 4 * s);
  }

  aligned(ops, fmtPriceShort(content.price), "left", x0, x1, y, priceSize, true);
  y += Math.round(priceSize * 1.16);

  // Precio por unidad de medida (exigido en la exhibición de precios).
  const unitSize = Math.round(12 * s);
  if (content.unit === "kg" && content.price > 0) {
    aligned(ops, `${fmtMoney(content.price, 2)} /kg`, "left", x0, x1, y, unitSize, true);
  } else {
    aligned(ops, "PRECIO POR UNIDAD", "left", x0, x1, y, Math.round(10 * s), false);
  }
  y += Math.round(16 * s);

  // Código en el espacio restante
  const bottomPad = Math.round(5 * s);
  const avail = heightPx - y - bottomPad;
  const barcode =
    avail >= 24
      ? buildBarcodeBlock({
          ops,
          warnings,
          content: { ...content, plu: null },
          scaleFmt: opts.scaleFormat ?? null,
          x0,
          x1,
          y,
          maxHeight: avail,
        })
      : (warnings.push("No queda alto para el código de barras."),
        { symbology: "none" as const, digits: content.code || "", module: 0 });

  return {
    widthPx,
    heightPx,
    widthMm: Math.round(widthPx / LABEL_PX_PER_MM),
    heightMm: Math.round(heightPx / LABEL_PX_PER_MM),
    ops,
    warnings,
    barcode,
  };
}

export function buildLabelSpec(
  content: LabelContent,
  cfg: LabelPrinterConfig,
  opts: BuildLabelOptions = {}
): LabelSpec {
  const { widthPx, heightPx } = labelPixelSize(cfg);
  if (content.template === "gondola") return buildGondola(content, widthPx, heightPx, opts);
  return buildEnvasado(content, widthPx, heightPx, opts);
}
