import type { Ingredient, Recipe, RecipeItem } from "@/types/database";

/** Unidad base de un insumo (definida en @/types/database). */
export type { IngredientUnit } from "@/types/database";

/**
 * Módulo Recetas (escandallo) — aritmética pura, estilo Fudo.
 *
 * Cadena de cálculo por línea de receta:
 *   1. cantidad NETA (lo que queda en el plato) en la unidad de la línea
 *   2. → conversión a unidad base del insumo (g / ml / u)
 *   3. → cantidad BRUTA = neta / (1 - merma)  [lo que hay que comprar/usar]
 *   4. → costo de línea = bruta × costo unitario del insumo
 * Costo de receta = Σ líneas (+ recursión en sub-recetas).
 * Costos siempre SIN IVA (precio neto de factura).
 */

// Familia de unidades → factor de conversión a la unidad base.
const WEIGHT_UNITS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  cc: 1,
  cl: 10,
  l: 1000,
  L: 1000,
  lt: 1000,
  lts: 1000,
};
const UNIT_UNITS: Record<string, number> = {
  u: 1,
  un: 1,
  "u.": 1,
  unidad: 1,
  unidades: 1,
  doc: 12,
  docena: 12,
};

export type UnitFamily = "g" | "ml" | "u";

const FAMILY_OF_BASE: Record<string, UnitFamily> = { g: "g", ml: "ml", u: "u" };

function familyOf(unit: string): { family: UnitFamily; factor: number } | null {
  const u = unit.trim().toLowerCase();
  if (u in WEIGHT_UNITS) return { family: "g", factor: WEIGHT_UNITS[u] };
  if (u in VOLUME_UNITS) return { family: "ml", factor: VOLUME_UNITS[u] };
  if (u in UNIT_UNITS) return { family: "u", factor: UNIT_UNITS[u] };
  return null;
}

/** Convierte una cantidad en `unit` a la unidad base del insumo.
 *  Devuelve null si la unidad es desconocida o incompatible
 *  (ej. gramos contra un insumo en unidades). */
export function toBaseUnit(
  qty: number,
  unit: string,
  baseUnit: string
): number | null {
  const f = unitFactor(unit, baseUnit);
  return f === null ? null : qty * f;
}

/** Factor de conversión de `unit` a la unidad base (para 1 unidad).
 *  Ej.: unitFactor('kg', 'g') = 1000. Null si incompatible. */
export function unitFactor(unit: string, baseUnit: string): number | null {
  const from = familyOf(unit);
  const baseFamily = FAMILY_OF_BASE[baseUnit];
  if (!from || !baseFamily || from.family !== baseFamily) return null;
  return from.factor;
}

/** Cantidad BRUTA a partir de la neta y el % de merma.
 *  Ej.: 300 g netos con 5% merma → 315,79 g brutos. */
export function grossQty(qtyNet: number, wastePct: number): number {
  const w = Math.min(Math.max(Number(wastePct) || 0, 0), 99.99);
  return qtyNet / (1 - w / 100);
}

export type CostLine = {
  ingredient_id: string;
  name: string;
  is_elaborated: boolean;
  qty_net: number;
  unit: string;
  /** Cantidad bruta expresada en la unidad base del insumo. */
  qty_gross_base: number;
  base_unit: string;
  /** Costo de esta línea (ya dividido por porciones si es sub-receta). */
  line_cost: number;
  /** Desglose recursivo si es sub-receta. */
  sub: RecipeCost | null;
};

export type RecipeCost = {
  /** Costo total de la receta (todas las porciones). */
  total: number;
  /** Costo por porción/unidad de rinde. */
  perPortion: number;
  portions: number;
  lines: CostLine[];
  warnings: string[];
};

export type CostingMaps = {
  ingredients: Map<string, Ingredient>;
  /** Recetas indexadas por `p:<productId>` y `i:<ingredientId>`. */
  byProduct: Map<string, { recipe: Recipe; items: RecipeItem[] }>;
  byIngredient: Map<string, { recipe: Recipe; items: RecipeItem[] }>;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const MAX_DEPTH = 5;

function emptyCost(portions: number): RecipeCost {
  return { total: 0, perPortion: 0, portions, lines: [], warnings: [] };
}

/**
 * Calcula el costo de la receta de un plato (`{ productId }`) o de un
 * insumo elaborado (`{ ingredientId }`), resolviendo sub-recetas de
 * forma recursiva con guardia anti-ciclos.
 */
export function computeRecipeCost(
  target: { productId: string } | { ingredientId: string },
  maps: CostingMaps,
  seen: string[] = [],
  depth = 0
): RecipeCost {
  const entry =
    "productId" in target
      ? maps.byProduct.get(target.productId)
      : maps.byIngredient.get(target.ingredientId);

  if (!entry) return emptyCost(1);
  const { recipe, items } = entry;
  const portions = Number(recipe.portions) > 0 ? Number(recipe.portions) : 1;
  const cost: RecipeCost = { total: 0, perPortion: 0, portions, lines: [], warnings: [] };

  if (depth > MAX_DEPTH) {
    cost.warnings.push("Receta demasiado anidada (máx. 5 niveles): se cortó el cálculo.");
    return cost;
  }

  const ordered = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  for (const item of ordered) {
    const ing = maps.ingredients.get(item.ingredient_id);
    if (!ing) {
      cost.warnings.push(`Línea sin insumo válido (se ignoró).`);
      continue;
    }
    const qtyNet = Number(item.qty_net) || 0;
    const grossBase = toBaseUnit(qtyNet, item.unit, ing.base_unit);
    if (grossBase === null) {
      cost.warnings.push(
        `“${ing.name}”: la unidad “${item.unit}” no es compatible con “${ing.base_unit}” (se ignoró la línea).`
      );
      continue;
    }

    // Sub-receta: costo recursivo por porción del elaborado.
    if (ing.is_elaborated) {
      const key = `i:${ing.id}`;
      if (seen.includes(key)) {
        cost.warnings.push(`“${ing.name}”: referencia circular (se ignoró).`);
        continue;
      }
      const subEntry = maps.byIngredient.get(ing.id);
      if (!subEntry) {
        // Sin receta cargada: fallback al costo manual del insumo.
        const gross = grossQty(grossBase, Number(ing.waste_pct) || 0);
        const lineCost = round2(gross * (Number(ing.cost_per_unit) || 0));
        cost.total += lineCost;
        cost.warnings.push(`“${ing.name}” es elaborado pero no tiene receta: se usó su costo manual.`);
        cost.lines.push({
          ingredient_id: ing.id,
          name: ing.name,
          is_elaborated: true,
          qty_net: qtyNet,
          unit: item.unit,
          qty_gross_base: round2(gross),
          base_unit: ing.base_unit,
          line_cost: lineCost,
          sub: null,
        });
        continue;
      }
      const sub = computeRecipeCost({ ingredientId: ing.id }, maps, [...seen, key], depth + 1);
      // La línea usa `grossBase` unidades base del elaborado; la sub-receta
      // rinde `sub.portions` en esa misma unidad → se prorratea.
      const subPortions = sub.portions > 0 ? sub.portions : 1;
      const lineCost = round2((grossBase / subPortions) * sub.total);
      cost.total += lineCost;
      cost.warnings.push(...sub.warnings.map((w) => `“${ing.name}”: ${w}`));
      cost.lines.push({
        ingredient_id: ing.id,
        name: ing.name,
        is_elaborated: true,
        qty_net: qtyNet,
        unit: item.unit,
        qty_gross_base: round2(grossQty(grossBase, Number(ing.waste_pct) || 0)),
        base_unit: ing.base_unit,
        line_cost: lineCost,
        sub,
      });
      continue;
    }

    const gross = grossQty(grossBase, Number(ing.waste_pct) || 0);
    const lineCost = round2(gross * (Number(ing.cost_per_unit) || 0));
    cost.total += lineCost;
    cost.lines.push({
      ingredient_id: ing.id,
      name: ing.name,
      is_elaborated: false,
      qty_net: qtyNet,
      unit: item.unit,
      qty_gross_base: round2(gross),
      base_unit: ing.base_unit,
      line_cost: lineCost,
      sub: null,
    });
  }

  cost.total = round2(cost.total);
  cost.perPortion = round2(cost.total / portions);
  return cost;
}

/** Arma los mapas de costeo a partir de filas planas de la DB. */
export function buildCostingMaps(
  ingredients: Ingredient[],
  recipes: { recipe: Recipe; items: RecipeItem[] }[]
): CostingMaps {
  const ingMap = new Map(ingredients.map((i) => [i.id, i]));
  const byProduct = new Map<string, { recipe: Recipe; items: RecipeItem[] }>();
  const byIngredient = new Map<string, { recipe: Recipe; items: RecipeItem[] }>();
  for (const r of recipes) {
    if (r.recipe.product_id) byProduct.set(r.recipe.product_id, r);
    if (r.recipe.ingredient_id) byIngredient.set(r.recipe.ingredient_id, r);
  }
  return { ingredients: ingMap, byProduct, byIngredient };
}

// ---------- Métricas ----------

/** Food cost % = (costo / precio) × 100. Null si no hay precio. */
export function foodCostPct(cost: number, price: number | null | undefined): number | null {
  const p = Number(price);
  if (!p || p <= 0) return null;
  return round2((cost / p) * 100);
}

/** Precio de venta sugerido para un food-cost objetivo (default 30%). */
export function suggestedPrice(cost: number, targetPct = 30): number {
  const t = Number(targetPct);
  if (!t || t <= 0 || t >= 100) return round2(cost);
  return round2(cost / (t / 100));
}

/**
 * Costo de una presentación vinculada: total del batch ÷ rinde × servings.
 * Ej.: torta total $9.000, rinde 6 → porción (servings=1) $1.500,
 * torta entera (servings=6) $9.000.
 */
export function linkedCost(total: number, portions: number, servings: number): number {
  const p = Number(portions) > 0 ? Number(portions) : 1;
  const s = Number(servings) > 0 ? Number(servings) : 1;
  return round2((Number(total) / p) * s);
}

export type FoodCostStatus = "ok" | "warn" | "bad" | "none";

/** Umbrales del semáforo (defaults; el vendor puede editarlos). */
export const DEFAULT_THRESHOLDS = { warn: 30, bad: 35 };

/** Sanea umbrales (null/inválidos → defaults; exige warn < bad). */
export function resolveThresholds(
  warn: number | null | undefined,
  bad: number | null | undefined
): { warn: number; bad: number } {
  let w = Number(warn);
  let b = Number(bad);
  if (!isFinite(w) || w <= 0 || w >= 100) w = DEFAULT_THRESHOLDS.warn;
  if (!isFinite(b) || b <= 0 || b >= 100) b = DEFAULT_THRESHOLDS.bad;
  if (w >= b) {
    w = DEFAULT_THRESHOLDS.warn;
    b = DEFAULT_THRESHOLDS.bad;
  }
  return { warn: w, bad: b };
}

/** Semáforo: 🟢 < warn · 🟡 warn–bad · 🔴 > bad. */
export function foodCostStatus(
  pct: number | null,
  thresholds: { warn: number; bad: number } = DEFAULT_THRESHOLDS
): FoodCostStatus {
  if (pct === null || !isFinite(pct)) return "none";
  if (pct < thresholds.warn) return "ok";
  if (pct <= thresholds.bad) return "warn";
  return "bad";
}

export const FOOD_COST_STATUS_META: Record<FoodCostStatus, { label: string; className: string }> = {
  ok: { label: "Saludable", className: "bg-green-100 text-green-700" },
  warn: { label: "Ajustar", className: "bg-amber-100 text-amber-700" },
  bad: { label: "Revisar", className: "bg-red-100 text-red-700" },
  none: { label: "Sin precio", className: "bg-gray-100 text-gray-500" },
};

/** Unidades ofrecidas en el selector según la familia de la unidad base. */
export const LINE_UNITS: Record<UnitFamily, string[]> = {
  g: ["mg", "g", "kg"],
  ml: ["ml", "cl", "l"],
  u: ["u", "doc"],
};

/** Tipos de comprobante de compra (AR) con su etiqueta. */
export const RECEIPT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "ninguno", label: "Sin comprobante" },
  { value: "ticket", label: "Ticket" },
  { value: "remito", label: "Remito" },
  { value: "factura_b", label: "Factura B" },
  { value: "factura_c", label: "Factura C" },
  { value: "factura_a", label: "Factura A" },
];

export const RECEIPT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  RECEIPT_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

export const BASE_UNIT_LABEL: Record<UnitFamily, string> = {
  g: "Peso (g)",
  ml: "Volumen (ml)",
  u: "Unidad",
};

/**
 * Mermas de referencia por tipo de insumo. Son un PUNTO DE PARTIDA
 * editable: la merma real depende del proveedor y de cada cocina
 * (conviene pesar bruto vs. neto alguna vez y ajustarla).
 */
export const WASTE_PRESETS: { value: string; label: string; waste: number }[] = [
  { value: "carne", label: "Carne vacuna", waste: 20 },
  { value: "pollo", label: "Pollo", waste: 15 },
  { value: "pescado", label: "Pescado entero", waste: 40 },
  { value: "hoja", label: "Verduras de hoja", waste: 20 },
  { value: "verdura", label: "Verduras general", waste: 12 },
  { value: "fruta", label: "Frutas", waste: 15 },
  { value: "papa", label: "Papas", waste: 18 },
  { value: "aceite", label: "Aceite", waste: 0 },
  { value: "almacen", label: "Secos / almacén", waste: 0 },
  { value: "otro", label: "Otro", waste: 0 },
];

export function formatMoney(n: number): string {
  return `$${Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
