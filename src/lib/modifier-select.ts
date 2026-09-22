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
