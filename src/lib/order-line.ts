/**
 * Cálculo de monto de línea pack-aware.
 *
 * Regla de oro: el precio del PACK es la fuente de la plata, nunca la suma de
 * unidades redondeadas (11500/6=1916,67 — 6×1916,67 = 11500,02 > 11500).
 *
 * - OrderItem (persistido): `price` = precio del PACK COMPLETO (mods incluidos)
 *   y `pack_size` >= 2. Línea = price × (qty/pack_size).
 * - CartItem: `price` = precio por unidad (derivado, display "c/u") y
 *   `packPrice` = precio del pack. Línea = packPrice × (qty/packSize) + mods×qty.
 * - Sin pack: línea = (price + mods) × qty (comportamiento histórico).
 */

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Longitud del pack efectiva (1 si el producto va por unidad). */
export function packSizeOf(item: { pack_size?: number | null; packSize?: number | null }): number {
  const n = Number(item.pack_size ?? item.packSize);
  return Number.isInteger(n) && n >= 2 ? n : 1;
}

/** Suma de modificadores por unidad (por etiqueta price_mod). */
export function modsPerUnit(item: { modifiers?: unknown }): number {
  const mods: unknown[] = Array.isArray(item.modifiers) ? item.modifiers : [];
  return mods.reduce<number>((s, m) => {
    if (m && typeof m === "object") return s + (Number((m as { price_mod?: unknown }).price_mod) || 0);
    return s;
  }, 0);
}

/** Monto de una línea persistida (OrderItem: price ya trae mods baked, = precio del pack). */
export function orderLineTotal(item: { price: number; qty: number; pack_size?: number | null }): number {
  const pack = packSizeOf(item);
  const qty = Number(item.qty) || 0;
  if (pack >= 2) return round2(Number(item.price) * (qty / pack));
  return round2(Number(item.price) * qty);
}

/** Monto de una línea de carrito (CartItem: price por unidad, packPrice por pack, mods aparte). */
export function cartLineTotal(item: {
  price: number;
  qty: number;
  packSize?: number;
  packPrice?: number;
  modifiers?: unknown;
}): number {
  const mods = modsPerUnit(item);
  const qty = Number(item.qty) || 0;
  if (item.packSize && item.packSize >= 2 && item.packPrice != null) {
    return round2(Number(item.packPrice) * (qty / item.packSize) + mods * qty);
  }
  return round2((Number(item.price) + mods) * qty);
}

/** Precio por unidad informativo ("c/u $X" — puede no ser exacto, es display). */
export function derivedUnitPrice(item: { price: number; pack_size?: number | null; packSize?: number | null }): number {
  const pack = packSizeOf(item);
  if (pack >= 2) return Math.round((Number(item.price) / pack) * 100) / 100;
  return Number(item.price);
}
