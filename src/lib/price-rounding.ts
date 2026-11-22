/**
 * Reglas de redondeo de precios — Fase A del plan "costo → ganancia → precio".
 *
 * Un precio con regla de redondeo toma valores de la forma `k·step + tail`:
 *   - step 100, tail 0   → $1.200, $1.300, $1.400…
 *   - step 1,   tail .99 → $1.234,99 (charm pricing)
 *   - step 100, tail 99  → $1.299
 *
 * Direcciones (como VTEX / Dux / RMH POS):
 *   - nearest: mitad abajo / mitad arriba, EMPATE → ARRIBA (idéntico a
 *     `Math.round` cuando tail=0 y step=1: compatibilidad total con lo que
 *     ya hacían las listas de margen y los precios masivos).
 *   - up: siempre al candidato superior (blinda margen, infla ~+step/2).
 *   - down: siempre al inferior.
 *
 * La regla se aplica SOLO a precios calculados (lista de margen, operación
 * masiva, sugerido del recetario). Nunca a promos definidas a mano, ni a
 * descuentos (volumen/efectivo), ni al total del carrito.
 *
 * Autocontenido y client-safe: sin imports (lo consumen rutas server,
 * componentes y el check script).
 */

export type RoundMode = "nearest" | "up" | "down";

export type Rounding = {
  /** Distancia entre precios válidos (múltiplo). > 0. */
  step: number;
  mode: RoundMode;
  /** Offset dentro del múltiplo: 0 = múltiplo exacto; 0 ≤ tail < step. */
  tail: number;
};

/** Entrada laxa (DB, JSON, form): se sanea en resolveRounding. */
export type RoundingInput = { step?: unknown; mode?: unknown; tail?: unknown } | null | undefined;

/** Default neutro: reproduce exactamente el `Math.round` histórico. */
export const ROUNDING_DEFAULT: Rounding = { step: 1, mode: "nearest", tail: 0 };

/** Múltiplos ofrecidos en la UI. */
export const ROUND_STEPS = [1, 5, 10, 50, 100, 500, 1000] as const;

export const ROUND_MODE_OPTIONS: { id: RoundMode; label: string; hint: string }[] = [
  { id: "nearest", label: "Al más cercano", hint: "Mitad abajo / mitad arriba (empate → arriba). No infla el promedio." },
  { id: "up", label: "Siempre hacia arriba", hint: "Blinda el margen; en promedio suma medio múltiplo por producto." },
  { id: "down", label: "Siempre hacia abajo", hint: "Precio más agresivo; en promedio resta medio múltiplo." },
];

/** Terminaciones: offset dentro del múltiplo. Solo son válidas las < step. */
export const ROUND_TAIL_PRESETS: { id: string; label: string; tail: number }[] = [
  { id: "exact", label: "Múltiplo exacto", tail: 0 },
  { id: "cents90", label: "…,90", tail: 0.9 },
  { id: "cents95", label: "…,95", tail: 0.95 },
  { id: "cents99", label: "…,99", tail: 0.99 },
  { id: "end90", label: "Termina en 90", tail: 90 },
  { id: "end95", label: "Termina en 95", tail: 95 },
  { id: "end99", label: "Termina en 99", tail: 99 },
];

/** Terminaciones aplicables al múltiplo elegido (tail < step). */
export function tailOptionsFor(step: number): typeof ROUND_TAIL_PRESETS {
  return ROUND_TAIL_PRESETS.filter((p) => p.tail < step);
}

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Sanea una regla (de DB, body o form). Nunca lanza; inválido → default. */
export function resolveRounding(input?: RoundingInput): Rounding {
  if (!input) return { ...ROUNDING_DEFAULT };
  const stepRaw = Number(input.step);
  let step = Number.isFinite(stepRaw) && stepRaw > 0 ? roundMoney(stepRaw) : ROUNDING_DEFAULT.step;
  if (step > 100000) step = 100000;
  if (step < 0.01) step = 0.01;
  const mode: RoundMode = input.mode === "up" || input.mode === "down" || input.mode === "nearest" ? input.mode : "nearest";
  const tailRaw = Number(input.tail);
  let tail = Number.isFinite(tailRaw) && tailRaw > 0 ? roundMoney(tailRaw) : 0;
  if (tail >= step) tail = 0; // cola inválida para ese múltiplo → múltiplo exacto
  return { step, mode, tail };
}

/** Regla global del comercio (columnas vendors.price_round_*). */
export function roundingFromVendor(v: {
  price_round_step?: number | string | null;
  price_round_mode?: string | null;
  price_round_tail?: number | string | null;
} | null | undefined): Rounding {
  if (!v) return { ...ROUNDING_DEFAULT };
  return resolveRounding({ step: v.price_round_step, mode: v.price_round_mode, tail: v.price_round_tail });
}

/** true = la regla no cambia nada respecto de redondear al entero más cercano. */
export function isDefaultRounding(rule?: RoundingInput | null): boolean {
  const r = resolveRounding(rule);
  return r.step === 1 && r.mode === "nearest" && r.tail === 0;
}

/**
 * Aplica la regla a un precio. Genera los dos candidatos con cola que rodean
 * al precio y elige según el modo. Nunca devuelve negativos ni lanza.
 */
export function applyRounding(price: number, rule?: RoundingInput): number {
  const r = resolveRounding(rule);
  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) return 0;
  const step = r.step;
  const tail = r.tail;
  // Epsilon: 1234 - 99 = 1135 → floor(11.35) = 11 → low 1199, high 1299.
  const q = Math.floor((p - tail + 1e-9) / step);
  const low = q * step + tail; // ≤ p (con empate exacto cuando p ya es candidato)
  const high = low + step; // ≥ p, siempre > p salvo step 0 (imposible)
  const exact = Math.abs(low - p) < 1e-9;
  if (r.mode === "down") {
    // Mayor candidato ≤ precio (RMH: "inferior o igual").
    return roundMoney(low >= 0 ? low : Math.max(high, 0));
  }
  if (r.mode === "up") {
    // Menor candidato ≥ precio (RMH: "superior o igual"): si p ya es
    // candidato exacto, se queda igual (no salta al siguiente múltiplo).
    return roundMoney(exact && low >= 0 ? low : Math.max(high, 0));
  }
  // nearest: el más cercano; empate → arriba (VTEX/Dux/RMH y Math.round).
  if (exact && low >= 0) return roundMoney(low);
  const dLo = p - low;
  const dHi = high - p;
  if (low < 0) return roundMoney(high);
  if (dHi < dLo - 1e-9) return roundMoney(high);
  if (dLo < dHi - 1e-9) return roundMoney(low);
  return roundMoney(high);
}

/** Descripción corta para UI: "Múltiplo de $100 · al más cercano". */
export function describeRounding(rule?: RoundingInput | null): string {
  const r = resolveRounding(rule);
  if (isDefaultRounding(r)) return "Sin redondeo especial (al peso, sin decimales)";
  const modeLabel: Record<RoundMode, string> = { nearest: "al más cercano", up: "hacia arriba", down: "hacia abajo" };
  const base = r.tail > 0
    ? `Termina en ${r.tail < 1 ? "," + String(Math.round(r.tail * 100)).padStart(2, "0") : String(Math.round(r.tail))}`
    : `Múltiplo de $${r.step.toLocaleString("es-AR")}`;
  return `${base} · ${modeLabel[r.mode]}`;
}

/** Ejemplo para mostrar en la UI: "$1.340 → $1.300". */
export function roundingExample(price: number, rule?: RoundingInput | null): string | null {
  const r = resolveRounding(rule);
  if (isDefaultRounding(r)) return null;
  const out = applyRounding(price, r);
  const fmt = (n: number) => `$${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  return `${fmt(Number(price))} → ${fmt(out)}`;
}

// ── Equivalencias de ganancia (Fase B: un solo vocabulario) ────────────────
// Tres formas de decir lo mismo:
//   recargo (markup)   = % sobre el costo     → precio = costo × (1 + m/100)
//   margen  (margin)   = % sobre el precio    → precio = costo / (1 − mg/100)
//   food cost          = costo / precio × 100 = 100 − margen

export type GainEquivalents = { markup: number; margin: number; foodCost: number };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function equivalentsFromMarkup(markupPct: number): GainEquivalents {
  const m = clampNum(markupPct, 0, 100000, 0);
  const margin = (m / (100 + m)) * 100;
  return { markup: round1(m), margin: round1(margin), foodCost: round1(100 - margin) };
}

export function equivalentsFromMargin(marginPct: number): GainEquivalents {
  const mg = clampNum(marginPct, 0, 99.9, 0);
  const markup = (mg / (100 - mg)) * 100;
  return { markup: round1(markup), margin: round1(mg), foodCost: round1(100 - mg) };
}

export function equivalentsFromFoodCost(foodCostPct: number): GainEquivalents {
  return equivalentsFromMargin(100 - clampNum(foodCostPct, 0.1, 99.9, 50));
}

/** Ganancia real de un producto: margen % y recargo equivalente. Null si no hay precio/costo válidos. */
export function gainFromPriceCost(
  price: number | null | undefined,
  cost: number | null | undefined
): { margin: number; markup: number; foodCost: number } | null {
  const p = Number(price);
  const c = Number(cost);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(c) || c < 0) return null;
  const margin = ((p - c) / p) * 100;
  return { margin: round1(margin), markup: round1(c > 0 ? ((p - c) / c) * 100 : 0), foodCost: round1((c / p) * 100) };
}
