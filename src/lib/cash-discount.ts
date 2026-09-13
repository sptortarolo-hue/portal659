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

/**
 * Ítem para el cálculo de descuento compartido (Mostrador en vivo + precuenta
 * de mesa + `pos/order` + cierre de mesa — misma fórmula en todos lados).
 * `unitPrice` ya incluye modificadores (el descuento corre sobre el total de
 * la unidad, igual que en `resolveOrderPricing`).
 */
export type CashDiscountItem = {
  unitPrice: number;
  qty: number;
  hasPromo: boolean;
  excluded?: boolean | null;
};

/**
 * Descuento en efectivo de un conjunto de ítems. Devuelve el monto a descontar
 * y el % normalizado (0/0 si no corresponde). Capado al subtotal.
 */
export function cashDiscountForItems(
  items: CashDiscountItem[],
  pct: unknown
): { cashDiscount: number; cashPct: number } {
  const p = normalizeCashPct(pct);
  if (!p || !Array.isArray(items) || items.length === 0) {
    return { cashDiscount: 0, cashPct: 0 };
  }
  let subtotal = 0;
  let discount = 0;
  for (const it of items) {
    if (!it) continue;
    const qty = Number.isFinite(Number(it.qty)) ? Math.min(99, Math.max(1, Math.floor(Number(it.qty)))) : 1;
    const unit = round2(Number(it.unitPrice) || 0);
    subtotal += unit * qty;
    if (cashAppliesToItem({ hasPromo: it.hasPromo, excluded: it.excluded })) {
      discount += round2((unit - cashPrice(unit, p)) * qty);
    }
  }
  subtotal = round2(subtotal);
  return { cashDiscount: round2(Math.min(discount, subtotal)), cashPct: p };
}
