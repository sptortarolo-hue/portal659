/**
 * Detección de opciones duplicadas entre grupos de modificadores (client-safe:
 * se usa en la solapa Opciones del panel, sin tocar la base).
 *
 * Problema que resuelve: el mismo grupo de opciones se carga más de una vez
 * ("Adicionales" en la hamburguesa y "Extras" en las empanadas) y la misma
 * opción ("Extra con papas fritas") queda con precios distintos según el
 * grupo. El comercio no se da cuenta y en la venta ve listas inconsistente.
 *
 * Detecta tres cosas:
 *   1. La misma opción (label normalizado) en ≥2 grupos distintos, avisando
 *      cuando los precios no coinciden.
 *   2. La misma opción repetida dentro de un mismo grupo (saldría dos veces
 *      iguales en el picker de venta).
 *   3. Dos grupos con el mismo nombre.
 */

import { normSearch } from "@/lib/search-match";
import type { ModifierGroup } from "@/types/database";

export type OptionOccurrence = {
  group_id: string;
  group_name: string;
  /** Nombres de los productos asignados al grupo (para dar contexto). */
  product_names: string[];
  /** Precio normal de la opción según el modo de precio del grupo. */
  price: number;
  /** Promo vigente de la opción (null = sin promo). */
  promo: number | null;
  price_mode: "diferencia" | "total";
  /** Opción pausada (oculta en la venta). */
  paused: boolean;
  /** Familia de la opción, si tiene (informativo: no entra en el match). */
  family?: string;
};

export type DuplicateOption = {
  /** Etiqueta tal como se ve (la de la primera aparición). */
  label: string;
  occurrences: OptionOccurrence[];
  /** true si los precios normales no coinciden entre apariciones. */
  pricesDiffer: boolean;
};

export type RepeatedWithinGroup = {
  group_id: string;
  group_name: string;
  label: string;
  times: number;
};

export type DuplicateGroupName = {
  name: string;
  groups: { id: string; group_name: string; product_names: string[]; options_count: number }[];
};

export type OptionDuplicatesReport = {
  /** Misma opción en ≥2 grupos distintos. */
  crossGroups: DuplicateOption[];
  /** Misma opción repetida dentro de un mismo grupo. */
  withinGroup: RepeatedWithinGroup[];
  /** Grupos que comparten nombre. */
  groupNames: DuplicateGroupName[];
  /** Total de hallazgos (para el contador de la sección). */
  total: number;
};

/** Etiqueta comparable: minúsculas, sin tildes, espacios colapsados. */
export function normalizeOptionLabel(s: unknown): string {
  return normSearch(s).replace(/\s+/g, " ").trim();
}

/** Precio normal de la opción según el modo del grupo. */
export function optionPrice(o: ModifierGroup["options"][number], priceMode: string | null | undefined): number {
  const total = Number(o?.price_total);
  if (priceMode === "total" && Number.isFinite(total) && total >= 0) return total;
  return Number(o?.price_mod) || 0;
}

/** Precio redondeado a 2 decimales (evita falsos "distintos" por flotantes). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Analiza los grupos del comercio y devuelve los duplicados.
 * `productNames` resuelve id → nombre para mostrar a qué productos afecta.
 */
export function findOptionDuplicates(
  groups: (ModifierGroup & { product_ids?: string[] })[],
  productNames: Record<string, string> = {}
): OptionDuplicatesReport {
  const namesOf = (ids?: string[]) =>
    (ids || []).map((id) => productNames[id] || "").filter(Boolean);

  // 1) Misma opción en ≥2 grupos distintos.
  const byLabel = new Map<string, { label: string; occurrences: OptionOccurrence[] }>();
  for (const g of groups) {
    const mode = g.price_mode === "total" ? "total" : "diferencia";
    for (const o of g.options || []) {
      const key = normalizeOptionLabel(o.label);
      if (!key) continue;
      const entry = byLabel.get(key) || { label: String(o.label || "").trim(), occurrences: [] };
      entry.occurrences.push({
        group_id: g.id,
        group_name: g.group_name,
        product_names: namesOf(g.product_ids),
        price: round2(optionPrice(o, mode)),
        promo: o.promo != null && Number.isFinite(Number(o.promo)) ? Number(o.promo) : null,
        price_mode: mode,
        paused: o.available === false,
        family: o.category,
      });
      byLabel.set(key, entry);
    }
  }
  const crossGroups: DuplicateOption[] = [];
  for (const { label, occurrences } of byLabel.values()) {
    // Solo interesa cuando aparece en más de un grupo (o repetida en el mismo,
    // pero eso se reporta aparte y con más precisión).
    const groupsSeen = new Set(occurrences.map((o) => o.group_id));
    if (groupsSeen.size < 2) continue;
    const prices = new Set(occurrences.map((o) => o.price));
    crossGroups.push({ label, occurrences, pricesDiffer: prices.size > 1 });
  }
  crossGroups.sort((a, b) => {
    if (a.pricesDiffer !== b.pricesDiffer) return a.pricesDiffer ? -1 : 1;
    return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
  });

  // 2) Misma opción repetida dentro de un mismo grupo.
  const withinGroup: RepeatedWithinGroup[] = [];
  for (const g of groups) {
    const seen = new Map<string, number>();
    for (const o of g.options || []) {
      const key = normalizeOptionLabel(o.label);
      if (!key) continue;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [key, times] of seen) {
      if (times < 2) continue;
      const original = (g.options || []).find((o) => normalizeOptionLabel(o.label) === key);
      withinGroup.push({
        group_id: g.id,
        group_name: g.group_name,
        label: String(original?.label || key).trim(),
        times,
      });
    }
  }
  withinGroup.sort((a, b) => a.group_name.localeCompare(b.group_name, "es", { sensitivity: "base" }));

  // 3) Grupos con el mismo nombre.
  const byGroupName = new Map<string, ModifierGroup[]>();
  for (const g of groups) {
    const key = normalizeOptionLabel(g.group_name);
    if (!key) continue;
    const list = byGroupName.get(key) || [];
    list.push(g);
    byGroupName.set(key, list);
  }
  const groupNames: DuplicateGroupName[] = [];
  for (const [key, list] of byGroupName) {
    if (list.length < 2) continue;
    groupNames.push({
      name: list[0].group_name,
      groups: list.map((g) => ({
        id: g.id,
        group_name: g.group_name,
        product_names: namesOf(g.product_ids),
        options_count: (g.options || []).length,
      })),
    });
  }
  groupNames.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

  return {
    crossGroups,
    withinGroup,
    groupNames,
    total: crossGroups.length + withinGroup.length + groupNames.length,
  };
}
