/**
 * Reglas de peso para productos pesables (venta por kilo).
 * Config por comercio: múltiplo de venta (step) y peso mínimo.
 * Lo comparten el micrositio (validación en vivo) y el servidor (pricing.ts),
 * así el cliente y el comercio ven/producen exactamente lo mismo.
 */

export type WeightRules = {
  /** Múltiplo de venta en kg: 0 = libre (default). */
  step: number;
  /** Peso mínimo de venta en kg: 0 = sin mínimo. */
  min: number;
};

export const WEIGHT_MAX_KG = 99;

/** Lee la config tolerante: valores inválidos/ausentes = libre sin mínimo. */
export function readWeightRules(step?: unknown, min?: unknown): WeightRules {
  const s = Number(step);
  const m = Number(min);
  return {
    step: Number.isFinite(s) && s > 0 && s <= 1 ? s : 0,
    min: Number.isFinite(m) && m > 0 && m <= 50 ? m : 0,
  };
}

/** Etiqueta del paso para la UI ("de a 500 g", "de a 250 g"). */
export function weightStepLabel(step: number): string | null {
  if (step === 0.5) return "de a medio kilo";
  if (step === 0.25) return "de a cuarto de kilo";
  if (step > 0) return `de a ${(step * 1000).toLocaleString("es-AR")} g`;
  return null;
}

/** Fracciones típicas para los chips del micrositio (según el paso). */
export function weightChips(step: number): number[] {
  if (step === 0.5) return [0.5, 1, 1.5, 2];
  if (step === 0.25) return [0.25, 0.5, 0.75, 1];
  return [0.5, 1, 1.5, 2];
}

/** ¿El peso es válido para el carrito / el pedido? */
export function isValidWeight(kg: number, rules: WeightRules): boolean {
  if (!Number.isFinite(kg) || kg <= 0 || kg > WEIGHT_MAX_KG) return false;
  if (rules.min > 0 && kg < rules.min - 1e-9) return false;
  if (rules.step > 0) {
    const n = kg / rules.step;
    if (Math.abs(n - Math.round(n)) > 1e-6) return false;
  }
  return true;
}

/** Error legible cuando el peso no pasa las reglas del comercio. */
export function weightError(kg: number, rules: WeightRules, productName?: string): string | null {
  if (!Number.isFinite(kg) || kg <= 0 || kg > WEIGHT_MAX_KG) {
    return `Indicá el peso en kilos de "${productName || "el producto"}".`;
  }
  if (rules.min > 0 && kg < rules.min - 1e-9) {
    const g = (rules.min * 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 });
    return `El peso mínimo de venta es ${g} g.`;
  }
  if (rules.step > 0) {
    const n = kg / rules.step;
    if (Math.abs(n - Math.round(n)) > 1e-6) {
      return `Este producto se vende ${weightStepLabel(rules.step)}.`;
    }
  }
  return null;
}
