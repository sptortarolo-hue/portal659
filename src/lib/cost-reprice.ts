/**
 * Recálculo de precio desde costo, compartido por el bulk-price masivo
 * (markup_pct / margin_pct) y las Listas de margen (margin_lists).
 * Sin dependencias de servidor: usable desde rutas y (a futuro) cliente.
 */

export const PRICE_MAX = 99999999; // price es numeric(10,2)

export type MarginRule = "markup" | "margin";

export type MarginList = {
  id: string;
  name: string;
  rule: MarginRule;
  pct: number;
};

/** Precio entero desde costo según la regla. NULL si no hay costo válido. */
export function priceFromCost(cost: number | null, rule: MarginRule, pct: number): number | null {
  if (cost == null) return null;
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return null;
  if (rule === "markup") {
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return null;
    return Math.round((c * (100 + pct)) / 100);
  }
  // margin: precio = costo / (1 − margen/100); pct < 100 garantizado por CHECK.
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return null;
  return Math.round(c / (1 - pct / 100));
}

export function clampPrice(n: number): number {
  return Math.min(Math.max(0, Math.round(n)), PRICE_MAX);
}

/** Promo manteniendo el cociente promo/precio previo (topeada al nuevo precio).
 *  Devuelve null si no corresponde tocar la promo (opt-in apagado o datos inválidos). */
export function promoFromRatio(
  newPrice: number,
  oldPrice: number,
  oldPromo: number | null,
  includePromos: boolean
): number | null {
  if (!includePromos || oldPromo == null) return null;
  const p = Number(oldPromo);
  const oldP = Number(oldPrice);
  if (!Number.isFinite(p) || !Number.isFinite(oldP) || oldP <= 0) return null;
  const ratio = Math.min(Math.max(p, 0), oldP) / oldP;
  return Math.min(newPrice, Math.max(0, Math.round(newPrice * ratio)));
}

/** Etiqueta corta de la regla para la UI ("+100%" / "margen 50%"). */
export function marginListRuleLabel(list: Pick<MarginList, "rule" | "pct">): string {
  const pct = Number(list.pct);
  return list.rule === "markup" ? `Recargo +${trimNum(pct)}%` : `Margen ${trimNum(pct)}%`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
