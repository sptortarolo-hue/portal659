/**
 * Descuento en efectivo: fórmula única para micrositio, checkout (visual) y
 * servidor. El servidor (resolveOrderPricing) recalcula de todos modos.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Normaliza el % (0 si ausente/inválido; válido solo 0 < pct < 100). */
export function normalizeCashPct(value: unknown): number {
  const n = Number(value);
  if (!isFinite(n) || n <= 0 || n >= 100) return 0;
  return n;
}

/** Precio con descuento aplicado. Sin descuento válido devuelve el precio tal cual. */
export function cashPrice(price: number, pct: number): number {
  const p = normalizeCashPct(pct);
  if (!p) return round2(Number(price) || 0);
  return round2(Number(price) * (1 - p / 100));
}

/**
 * ¿El descuento corre sobre este ítem? Las promos excluidas por el comercio
 * (`cash_discount_excluded`) no lo reciben; el resto sí.
 */
export function cashAppliesToItem(opts: {
  hasPromo: boolean;
  excluded?: boolean | null;
}): boolean {
  if (!opts.hasPromo) return true;
  return !opts.excluded;
}
