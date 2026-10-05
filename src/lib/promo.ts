/**
 * Criterio de promos en dos niveles.
 *
 * - `isPromoListed` (OR amplio): decide qué ENTRA a la promo
 *   (dashboard, landing /promo, imagen, PATCH de selección).
 *   SQL: (promo_price IS NOT NULL OR promo_only = true).
 *   Un producto marcado promo_only sin precio promo también es promo.
 * - `isValidPromo` (AND estricto): decide qué MUESTRA descuento
 *   (titular -X%, precio tachado). Sin descuento computable la tarjeta
 *   muestra "PROMO" + precio único.
 * Client-safe: no importar `pg` ni nada server-only desde acá.
 */

export type PromoPriced = {
  price: number | string | null | undefined;
  promo_price: number | string | null | undefined;
  promo_only?: boolean | null | undefined;
};

export function isPromoListed(p: PromoPriced): boolean {
  return p.promo_price != null || p.promo_only === true;
}

export function isValidPromo(p: PromoPriced): boolean {
  const price = Number(p.price);
  const promo = Number(p.promo_price);
  return (
    Number.isFinite(price) &&
    Number.isFinite(promo) &&
    price > 0 &&
    promo > 0 &&
    promo < price
  );
}

export function discountOf(p: PromoPriced): number {
  if (!isValidPromo(p)) return 0;
  return Math.round((1 - Number(p.promo_price) / Number(p.price)) * 100);
}

export function promoMoney(n: number | string): string {
  return `$${Number(n).toLocaleString("es-AR")}`;
}
