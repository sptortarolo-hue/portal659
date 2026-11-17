/**
 * Etiquetas de balanza (EAN-13 "de medida variable") — parser y configuración.
 *
 * Las balanzas de mostrador imprimen un código de barras con el PLU del
 * producto y el peso (o el importe) en el propio código: no son EAN de
 * producto, así que ningún catálogo los conoce. El formato cambia por marca
 * y modelo (largo del PLU, largo del valor, prefijo, si el valor viene en
 * gramos o en kilos), por eso vive como configuración por comercio.
 *
 * Formato típico (EAN-13):  PREFIJO + PLU + VALOR + DV
 *   2 000123 00750 8   →  prefijo "2", PLU 000123, valor 00750 g, DV 8
 *
 * Este archivo es autocontenido a propósito (sin imports ni alias `@/`):
 * lo usan el panel, el Mostrador y `scripts/check-scale-barcode.mjs` (Node
 * ejecuta el TypeScript directo).
 */

export type ScaleValueKind = "peso_g" | "peso_kg" | "importe";
export type ScaleCheckDigit = "validar" | "ignorar" | "ninguno";

export type ScaleLabelConfig = {
  /** Si está apagado, el Mostrador no intenta leer etiquetas. */
  enabled: boolean;
  /** Prefijo del código (lo que antecede al PLU). Típico "2" o "20". */
  prefix: string;
  /** Cantidad de dígitos del PLU. */
  pluDigits: number;
  /** Cantidad de dígitos del valor (peso o importe). */
  valueDigits: number;
  /** Qué representa el valor impreso. */
  valueKind: ScaleValueKind;
  /** Decimales implícitos del valor impreso. */
  decimals: number;
  /** Qué hacer con el dígito verificador final. */
  checkDigit: ScaleCheckDigit;
};

/** Formato habitual de las balanzas (prefijo 2 GS1 = uso interno). */
export const DEFAULT_SCALE_LABEL_CONFIG: ScaleLabelConfig = {
  enabled: false,
  prefix: "2",
  pluDigits: 6,
  valueDigits: 5,
  valueKind: "peso_g",
  decimals: 0,
  checkDigit: "validar",
};

/** Peso máximo razonable de una etiqueta (mismo tope que la venta por kg). */
export const SCALE_LABEL_MAX_KG = 99;

const PLU_MAX = 12;
const PREFIX_MAX = 4;

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Lee la configuración tolerante: jsonb ausente, basura o valores fuera de
 * rango vuelven al default. Nunca lanza.
 */
export function readScaleLabelConfig(raw: unknown): ScaleLabelConfig {
  let value = raw;
  // Tolerante a jsonb servido como texto (o a un snapshot viejo serializado).
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const src = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const prefix = String(src.prefix ?? DEFAULT_SCALE_LABEL_CONFIG.prefix)
    .replace(/\D+/g, "")
    .slice(0, PREFIX_MAX);
  const valueKind: ScaleValueKind =
    src.valueKind === "peso_kg" || src.valueKind === "importe"
      ? src.valueKind
      : src.valueKind === "peso_g"
        ? "peso_g"
        : DEFAULT_SCALE_LABEL_CONFIG.valueKind;
  const checkDigit: ScaleCheckDigit =
    src.checkDigit === "ignorar" || src.checkDigit === "ninguno"
      ? src.checkDigit
      : src.checkDigit === "validar"
        ? "validar"
        : DEFAULT_SCALE_LABEL_CONFIG.checkDigit;
  return {
    enabled: src.enabled === true,
    prefix: prefix || DEFAULT_SCALE_LABEL_CONFIG.prefix,
    pluDigits: clampInt(src.pluDigits, 2, 8, DEFAULT_SCALE_LABEL_CONFIG.pluDigits),
    valueDigits: clampInt(src.valueDigits, 1, 8, DEFAULT_SCALE_LABEL_CONFIG.valueDigits),
    valueKind,
    decimals: clampInt(src.decimals, 0, 3, DEFAULT_SCALE_LABEL_CONFIG.decimals),
    checkDigit,
  };
}

/** Largo total que debería tener el código con esta configuración. */
export function scaleLabelLength(cfg: ScaleLabelConfig): number {
  return (
    cfg.prefix.length +
    cfg.pluDigits +
    cfg.valueDigits +
    (cfg.checkDigit === "ninguno" ? 0 : 1)
  );
}

/** Solo dígitos (los lectores a veces agregan espacios o guiones). */
export function onlyDigits(code: unknown): string {
  return String(code ?? "").replace(/\D+/g, "");
}

/**
 * Normaliza un PLU para comparar: "00123" ≡ "123". No toca los no numéricos
 * (algunas balanzas usan PLU alfanumérico) más que recortar y pasar a mayúsculas.
 */
export function normalizePlu(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return "";
  if (!/^\d+$/.test(s)) return s.slice(0, PLU_MAX);
  const trimmed = s.replace(/^0+/, "");
  return (trimmed === "" ? "0" : trimmed).slice(0, PLU_MAX);
}

/**
 * Dígito verificador GS1 (mod 10, pesos 3/1 de derecha a izquierda) para
 * EAN-8 / EAN-13 / GTIN-14. Devuelve el DV esperado del cuerpo.
 */
export function gtinCheckDigit(body: string): number | null {
  const digits = onlyDigits(body);
  if (digits.length < 2) return null;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** ¿El código (con su DV final) es un GTIN válido? */
export function isValidGtin(code: unknown): boolean {
  const digits = onlyDigits(code);
  if (digits.length < 2) return false;
  const expected = gtinCheckDigit(digits.slice(0, -1));
  return expected != null && expected === Number(digits[digits.length - 1]);
}

export type ScaleLabelKind = "peso" | "importe";

export type ParsedScaleLabel = {
  /** PLU normalizado (sin ceros a la izquierda). */
  plu: string;
  /** PLU tal como viene impreso (útil para mostrar). */
  pluRaw: string;
  kind: ScaleLabelKind;
  /** Kilos (solo en modo peso). */
  kg: number | null;
  /** Importe en pesos (solo en modo importe). */
  amount: number | null;
  /** Valor crudo del campo del código. */
  value: number;
  /** Código original normalizado a dígitos. */
  code: string;
};

/**
 * Parsea una etiqueta de balanza. Devuelve `null` si el código no tiene el
 * largo/el prefijo/el DV que pide la configuración (o si el valor no es
 * plausible). Tolera un `0` de más al principio que agregan algunos lectores.
 */
export function parseScaleLabel(
  code: unknown,
  config?: unknown
): ParsedScaleLabel | null {
  const cfg = readScaleLabelConfig(config);
  let digits = onlyDigits(code);
  if (!digits) return null;

  const expected = scaleLabelLength(cfg);
  // Lectores que agregan el "0" del EAN-13 corto: se prueba sin él.
  if (digits.length === expected + 1 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length !== expected) return null;
  if (!digits.startsWith(cfg.prefix)) return null;

  let p = cfg.prefix.length;
  const pluRaw = digits.slice(p, p + cfg.pluDigits);
  p += cfg.pluDigits;
  const valueRaw = digits.slice(p, p + cfg.valueDigits);
  p += cfg.valueDigits;
  const dvRaw = cfg.checkDigit === "ninguno" ? null : digits.slice(p, p + 1);

  if (!pluRaw || !valueRaw || !/^\d+$/.test(pluRaw) || !/^\d+$/.test(valueRaw)) {
    return null;
  }
  if (cfg.checkDigit === "validar") {
    if (!dvRaw || gtinCheckDigit(digits.slice(0, -1)) !== Number(dvRaw)) return null;
  }

  const value = Number(valueRaw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const scaled = value / Math.pow(10, cfg.decimals);

  if (cfg.valueKind === "importe") {
    const amount = Math.round(scaled * 100) / 100;
    if (!(amount > 0) || amount > 99_999_999) return null;
    return {
      plu: normalizePlu(pluRaw),
      pluRaw,
      kind: "importe",
      kg: null,
      amount,
      value,
      code: digits,
    };
  }

  const kgRaw = cfg.valueKind === "peso_g" ? scaled / 1000 : scaled;
  const kg = Math.round(kgRaw * 1000) / 1000;
  // Etiqueta de 0 kg o un peso absurdo = no es una etiqueta de balanza.
  if (!(kg > 0) || kg > SCALE_LABEL_MAX_KG) return null;
  return {
    plu: normalizePlu(pluRaw),
    pluRaw,
    kind: "peso",
    kg,
    amount: null,
    value,
    code: digits,
  };
}

export type ScaleFormatGuess = {
  config: ScaleLabelConfig;
  plu: string;
  pluRaw: string;
  kind: ScaleLabelKind;
  kg: number | null;
  amount: number | null;
};

/**
 * Prueba combinaciones de formato contra una etiqueta real y devuelve las que
 * hacen match con alguno de los PLUs del catálogo. Se usa en "Detectar
 * formato" del panel: el comercio escanea una etiqueta de un producto que ya
 * tiene PLU y elegimos el formato solos (si hay más de una coincidencia, la UI
 * pide confirmar).
 *
 * El orden es determinista: primero peso en gramos, después kg e importe, y
 * dentro de cada uno decimales 0 → 3 y DV validado antes que ignorado.
 */
export function guessScaleLabelFormats(
  code: unknown,
  knownPlus: string[],
  base?: Partial<ScaleLabelConfig>
): ScaleFormatGuess[] {
  const digits = onlyDigits(code);
  /** PLU normalizado → PLU impreso (primer caso encontrado). */
  const known = new Map<string, string>();
  for (const raw of knownPlus || []) {
    const n = normalizePlu(raw);
    if (n && !known.has(n)) known.set(n, String(raw ?? "").trim());
  }
  if (!digits || known.size === 0) return [];
  const starting = readScaleLabelConfig({ ...DEFAULT_SCALE_LABEL_CONFIG, ...(base || {}) });
  const out: ScaleFormatGuess[] = [];
  const seen = new Set<string>();

  const kinds: ScaleValueKind[] = ["peso_g", "peso_kg", "importe"];
  const checks: ScaleCheckDigit[] = ["validar", "ninguno"];
  for (let prefixLen = 1; prefixLen <= Math.min(PREFIX_MAX, 2); prefixLen++) {
    const prefix = digits.slice(0, prefixLen);
    if (!prefix) continue;
    for (let pluDigits = 2; pluDigits <= 8; pluDigits++) {
      for (let valueDigits = 1; valueDigits <= 8; valueDigits++) {
        for (const checkDigit of checks) {
          for (const valueKind of kinds) {
            for (let decimals = 0; decimals <= 3; decimals++) {
              const cfg: ScaleLabelConfig = {
                ...starting,
                enabled: true,
                prefix,
                pluDigits,
                valueDigits,
                valueKind,
                decimals,
                checkDigit,
              };
              if (scaleLabelLength(cfg) !== digits.length) continue;
              const parsed = parseScaleLabel(digits, cfg);
              if (!parsed) continue;
              const knownRaw = known.get(parsed.plu);
              if (!knownRaw) continue;
              const key = [
                cfg.prefix,
                cfg.pluDigits,
                cfg.valueDigits,
                cfg.valueKind,
                cfg.decimals,
                cfg.checkDigit,
              ].join("|");
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({
                config: cfg,
                plu: parsed.plu,
                pluRaw: parsed.pluRaw,
                kind: parsed.kind,
                kg: parsed.kg,
                amount: parsed.amount,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

/** "0,750 kg" / "1,250 kg" (coma decimal argentina, 3 decimales como el ticket). */
export function fmtScaleKg(kg: number | null | undefined): string {
  const n = Number(kg);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(3).replace(".", ",")} kg`;
}

/** Resumen corto de la config para el panel ("2 + 6 + 5 + DV (13 dígitos)"). */
export function scaleLabelFormatSummary(cfg: ScaleLabelConfig): string {
  const parts = [
    `prefijo ${cfg.prefix}`,
    `PLU ${cfg.pluDigits}`,
    `valor ${cfg.valueDigits}`,
    cfg.checkDigit === "ninguno" ? "sin DV" : cfg.checkDigit === "ignorar" ? "DV ignorado" : "DV validado",
  ];
  return `${parts.join(" · ")} · ${scaleLabelLength(cfg)} dígitos`;
}
