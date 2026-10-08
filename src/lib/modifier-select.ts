import type { ModifierOption } from "@/types/database";

/**
 * Lógica PURA de selección de modificadores (sin imports server/client):
 * la usan el micrositio, el ModifierPicker (desktop + Mostrador + Mesas) y el
 * servidor la replica en `resolveOrderPricing`. Cambiar acá = cambiar en todos
 * lados a la vez.
 *
 * Caso heladería: grupo "Gustos" con min 2 / max 2 en el 1/4 kg.
 */

export type ModifierGroupRule = {
  required?: boolean | null;
  is_variant?: boolean | null;
  max_selections?: number | null;
  /** NULL/ausente = legacy (≥1 si required, 0 si opcional). */
  min_selections?: number | null;
  /** "diferencia" (+$X, default) o "total" (precio final por opción, solo max=1). */
  price_mode?: string | null;
};

/** Umbral: grupos con más opciones se muestran como hoja con buscador. */
export const BIG_GROUP_THRESHOLD = 8;

/** Máximo saneado (≥1). */
export function effectiveMax(mod: ModifierGroupRule): number {
  const m = Math.floor(Number(mod.max_selections));
  return Number.isFinite(m) && m >= 1 ? m : 1;
}

/**
 * Mínimo efectivo. Solo aplica si el grupo es obligatorio (o variante, que lo
 * fuerza). Un grupo opcional nunca bloquea, aunque traiga min seteado.
 */
export function effectiveMin(mod: ModifierGroupRule): number {
  if (!mod.required && !mod.is_variant) return 0;
  const m = Math.floor(Number(mod.min_selections));
  if (Number.isFinite(m) && m >= 1) return Math.min(m, effectiveMax(mod));
  return 1;
}

/** Cuántas selecciones faltan para cumplir el mínimo (0 = ok). */
export function missingCount(mod: ModifierGroupRule, selectedCount: number): number {
  return Math.max(0, effectiveMin(mod) - selectedCount);
}

/**
 * Toggle con tope. Si está lleno y se elige una nueva, REEMPLAZA a la más
 * antigua (estilo PedidosYa) en vez de ignorar el tap. Devuelve la opción
 * desplazada para mostrar un hint ("se reemplazó vainilla").
 */
export function toggleWithCap(
  current: ModifierOption[],
  option: ModifierOption,
  max: number
): { next: ModifierOption[]; replaced: ModifierOption | null } {
  const exists = current.find((o) => o.label === option.label);
  if (exists) {
    return { next: current.filter((o) => o.label !== option.label), replaced: null };
  }
  const cap = Math.max(1, Math.floor(Number(max)) || 1);
  if (current.length >= cap) {
    return { next: [...current.slice(1), option], replaced: current[0] ?? null };
  }
  return { next: [...current, option], replaced: null };
}

/** Texto corto de estado del grupo ("Elegí 2", "1/3", "Hasta 3", "Opcional"). */
export function groupStatusText(mod: ModifierGroupRule, selectedCount: number): string {
  const max = effectiveMax(mod);
  const min = effectiveMin(mod);
  if (max <= 1) return min >= 1 ? "Elegí 1" : "Opcional";
  if (min >= max) return `Elegí ${max}`;
  if (min > 0) return `${selectedCount}/${max}`;
  return `Hasta ${max}`;
}

/** Mensaje de faltante ("Te falta 1 gusto", "Te faltan 2"). */
export function missingText(mod: ModifierGroupRule, selectedCount: number): string | null {
  const missing = missingCount(mod, selectedCount);
  if (missing <= 0) return null;
  return missing === 1 ? "Te falta 1" : `Te faltan ${missing}`;
}

/** Opciones visibles para elegir (excluye pausadas con available === false). */
export function activeOptions(options: ModifierOption[]): ModifierOption[] {
  return (options || []).filter((o) => o?.available !== false);
}

/**
 * Modo "total" del grupo: cada opción muestra su precio final y al elegirla
 * el ítem pasa a valer ese total. Solo vale con max_selections = 1
 * (el servidor lo enforcea; acá se chequea para display/cálculo).
 */
export function isTotalMode(mod: Pick<ModifierGroupRule, "price_mode" | "max_selections"> | null | undefined): boolean {
  if (!mod || mod.price_mode !== "total") return false;
  return Math.floor(Number(mod.max_selections)) === 1;
}

/** Precio final de la opción en modo total (null = sin total definido). */
export function optionTotalPrice(o: ModifierOption | null | undefined): number | null {
  const t = Number(o?.price_total);
  return Number.isFinite(t) && t >= 0 ? t : null;
}

/** Precio normal de la opción según modo (lo que se tacha si hay promo). */
export function normalOptionPrice(
  o: ModifierOption | null | undefined,
  totalMode: boolean
): number {
  if (totalMode) {
    const t = optionTotalPrice(o);
    if (t != null) return t;
  }
  return Number(o?.price_mod) || 0;
}

/** Promo válida de la opción (null = sin promo o inválida). Debe ser menor que el precio normal. */
export function promoOptionPrice(
  o: ModifierOption | null | undefined,
  totalMode: boolean
): number | null {
  const p = Number(o?.promo);
  if (!Number.isFinite(p) || p < 0) return null;
  const normal = normalOptionPrice(o, totalMode);
  return p < normal ? p : null;
}

/** Precio efectivo de la opción: promo válida o precio normal. */
export function effectiveOptionPrice(
  o: ModifierOption | null | undefined,
  totalMode: boolean
): number {
  return promoOptionPrice(o, totalMode) ?? normalOptionPrice(o, totalMode);
}

/**
 * Aporte de la opción al total del ítem (regla canónica: lo que se guarda
 * en `price_mod`). En modo total = efectivo_opción − base_producto
 * (la base se ignora); en diferencia = efectivo (promo o extra).
 */
export function optionContribution(
  o: ModifierOption,
  basePrice: number,
  totalMode: boolean
): number {
  if (totalMode) {
    return effectiveOptionPrice(o, true) - (Number(basePrice) || 0);
  }
  return effectiveOptionPrice(o, false);
}

/** ¿Alguna opción tiene promo válida? (marca el ítem en promo: sin cash). */
export function anyOptionPromo(
  opts: ModifierOption[],
  totalMode: boolean
): boolean {
  return (opts || []).some((o) => promoOptionPrice(o, totalMode) != null);
}

/** ¿Alguna opción SELECCIONADA tiene promo válida? Busca el grupo de cada selección. */
export function selectionHasPromo(
  groups:
    | {
        group_name: string;
        price_mode?: string | null;
        max_selections?: number | null;
        options?: ModifierOption[];
      }[]
    | null
    | undefined,
  selected: { group: string; label: string }[] | null | undefined
): boolean {
  for (const s of selected || []) {
    const g = (groups || []).find((x) => x.group_name === s.group);
    if (!g) continue;
    const total = isTotalMode(g);
    const opt = (g.options || []).find((o) => o.label === s.label);
    if (opt && promoOptionPrice(opt, total) != null) return true;
  }
  return false;
}

/** Mínimo efectivo del grupo (promo-aware, para "desde $X"). Null si no hay totales. */
export function minTotalPrice(options: ModifierOption[], totalMode = true): number | null {
  const r = totalPriceRange(options, totalMode);
  return r?.min ?? null;
}

/** Rango efectivo {min,max} de los totales del grupo (promo-aware). Null si no hay totales. */
export function totalPriceRange(
  options: ModifierOption[],
  totalMode = true
): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const o of options || []) {
    const t = totalMode ? optionTotalPrice(o) : null;
    if (t == null) continue;
    const eff = promoOptionPrice(o, true) ?? t;
    if (min == null || eff < min) min = eff;
    if (max == null || eff > max) max = eff;
  }
  return min == null || max == null ? null : { min, max };
}

/** Valida promos de una lista de opciones. Null = ok, string = mensaje de error. */
export function validateOptionPromos(
  options: { label?: string; price_mod?: number; price_total?: number | null; promo?: number | null }[],
  totalMode: boolean
): string | null {
  for (const o of options || []) {
    if (o?.promo == null || (o.promo as unknown) === "") continue;
    const p = Number(o.promo);
    const label = String(o?.label || "opción");
    if (!Number.isFinite(p) || p < 0) return `La promo de "${label}" no es un precio válido`;
    if (!(p < normalOptionPrice(o as ModifierOption, totalMode))) {
      return `La promo de "${label}" debe ser menor que su precio`;
    }
  }
  return null;
}

/** Familias presentes en las opciones (para chips de filtro). */
export function categoriesOf(options: ModifierOption[]): string[] {
  const seen: string[] = [];
  for (const o of options || []) {
    const c = String((o as ModifierOption)?.category ?? "").trim();
    if (c && !seen.includes(c)) seen.push(c);
  }
  return seen;
}

/** Filtro de opciones por texto + categoría (búsqueda insensible a acentos). */
export function filterOptions(
  options: ModifierOption[],
  query: string,
  category: string | null
): ModifierOption[] {
  const q = query.trim().toLowerCase();
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  return (options || []).filter((o) => {
    if (category && String(o.category ?? "").trim() !== category) return false;
    if (!q) return true;
    return norm(o.label).includes(norm(q));
  });
}
