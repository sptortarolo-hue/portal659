/**
 * Cálculo puro del lote de envasado (granel → paquetes).
 * Sin imports de servidor: lo usan la API y la pantalla de Envasado.
 *
 * Reglas:
 * - Las líneas de PESO de la receta (g/kg) se escalan por el pesaje real:
 *   cada una recibe una fracción del peso total según su proporción neta
 *   en la receta (ej. "nueces 400 g + pasas 100 g" → 80%/20% del pesaje).
 * - Las demás líneas (unidades: bolsa, sticker) se consumen por paquete,
 *   igual que el escandallo normal.
 * - La merma del insumo se aplica igual que en el escandallo:
 *   bruta = asignada / (1 - merma/100).
 * - El stock faltante NO aborta el cálculo: se reporta `missing` para que
 *   la API responda 409 con el detalle antes de escribir nada.
 *
 * Sin imports: lo usan la API, la pantalla de Envasado y el script de check.
 */

/** Familias de unidades → factor a la unidad base (espejo de costing.ts). */
const WEIGHT_UNITS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_UNITS: Record<string, number> = { ml: 1, cc: 1, cl: 10, l: 1000, L: 1000, lt: 1000, lts: 1000 };
const UNIT_UNITS: Record<string, number> = { u: 1, un: 1, "u.": 1, unidad: 1, unidades: 1, doc: 12, docena: 12 };

type UnitFamily = "g" | "ml" | "u";
const FAMILY_OF_BASE: Record<string, UnitFamily> = { g: "g", ml: "ml", u: "u" };

function familyOf(unit: string): { family: UnitFamily; factor: number } | null {
  const u = String(unit || "").trim().toLowerCase();
  if (u in WEIGHT_UNITS) return { family: "g", factor: WEIGHT_UNITS[u] };
  if (u in VOLUME_UNITS) return { family: "ml", factor: VOLUME_UNITS[u] };
  if (u in UNIT_UNITS) return { family: "u", factor: UNIT_UNITS[u] };
  return null;
}

function unitFactor(unit: string, baseUnit: string): number | null {
  const from = familyOf(unit);
  const baseFamily = FAMILY_OF_BASE[baseUnit];
  if (!from || !baseFamily || from.family !== baseFamily) return null;
  return from.factor;
}

function toBaseUnit(qty: number, unit: string, baseUnit: string): number | null {
  const f = unitFactor(unit, baseUnit);
  return f === null ? null : qty * f;
}

export type RecipeLineForBatch = {
  ingredient_id: string;
  name: string;
  base_unit: "g" | "ml" | "u";
  /** Cantidad NETA por paquete (lo que queda en el paquete, rinde 1). */
  qty_net: number;
  /** Unidad de la línea de receta (g, kg, ml, L, u...). */
  unit: string;
  waste_pct: number;
  cost_per_unit: number;
  /** Stock en unidad base. null = insumo sin control. undefined = sin migración. */
  stock?: number | null;
  /** true = línea salteada (elaborados anidados, no soportados en v1). */
  is_elaborated?: boolean;
};

export type BatchLineResult = {
  ingredient_id: string;
  name: string;
  base_unit: string;
  /** Cantidad bruta consumida, en unidad base (g/ml/u). */
  qty_consumed_base: number;
  cost: number;
};

export type BatchMissing = {
  ingredient_id: string;
  name: string;
  base_unit: string;
  need: number;
  have: number | null;
};

export type BatchComputation = {
  units: number;
  totalKg: number;
  lines: BatchLineResult[];
  costTotal: number;
  costPerUnit: number;
  missing: BatchMissing[];
};

function isWeightUnit(u: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    WEIGHT_UNITS,
    String(u || "").trim().toLowerCase()
  );
}

export function computeBatch(
  pesajesKg: number[],
  lines: RecipeLineForBatch[]
): BatchComputation {
  const bags = (pesajesKg || []).filter((k) => Number.isFinite(k) && k > 0);
  const units = bags.length;
  const totalKg = bags.reduce((s, k) => s + k, 0);

  // Proporción neta de cada línea de peso dentro del pesaje total.
  const weightLines = lines.filter((l) => isWeightUnit(l.unit));
  const weightNetKg = weightLines.map((l) => {
    const f = unitFactor(l.unit, l.base_unit === "ml" ? "ml" : "g");
    if (f === null) return 0;
    // qty en unidad base → kg (g→/1000, ml→/1000 como gramos equivalentes)
    const baseQty = l.qty_net * f;
    return baseQty / 1000;
  });
  const weightNetSum = weightNetKg.reduce((s, v) => s + v, 0);

  const results: BatchLineResult[] = [];
  const missing: BatchMissing[] = [];

  for (const line of lines) {
    const waste = Math.min(Math.max(Number(line.waste_pct) || 0, 0), 99.99);
    const wasteFactor = 1 - waste / 100;

    if (isWeightUnit(line.unit) && totalKg > 0 && weightNetSum > 0) {
      const idx = weightLines.indexOf(line);
      const share = weightNetKg[idx] / weightNetSum; // fracción del pesaje
      const assignedKg = totalKg * share;
      const grossKg = assignedKg / wasteFactor;
      // A unidad base: g o ml (peso). Sin conversión de densidad: se asume 1 g ≈ 1 ml solo si la base es ml.
      const basePerKg = line.base_unit === "g" ? 1000 : line.base_unit === "ml" ? 1000 : 1;
      const qtyBase = grossKg * basePerKg;
      results.push({
        ingredient_id: line.ingredient_id,
        name: line.name,
        base_unit: line.base_unit,
        qty_consumed_base: qtyBase,
        cost: qtyBase * Number(line.cost_per_unit || 0),
      });
      continue;
    }

    // Líneas por unidad (o sin pesaje registrado): como el escandallo clásico.
    const netPerUnit = toBaseUnit(Number(line.qty_net) || 0, line.unit, line.base_unit);
    if (netPerUnit === null) {
      // Línea incompatible: se ignora del consumo (la UI avisa por su cuenta).
      continue;
    }
    const qtyBase = (netPerUnit * units) / wasteFactor;
    results.push({
      ingredient_id: line.ingredient_id,
      name: line.name,
      base_unit: line.base_unit,
      qty_consumed_base: qtyBase,
      cost: qtyBase * Number(line.cost_per_unit || 0),
    });
  }

  // Chequeo de stock (solo insumos con control).
  for (const r of results) {
    const src = lines.find((l) => l.ingredient_id === r.ingredient_id);
    const stock = src?.stock;
    if (stock === undefined || stock === null) continue; // sin control
    if (r.qty_consumed_base > stock + 1e-9) {
      missing.push({
        ingredient_id: r.ingredient_id,
        name: r.name,
        base_unit: r.base_unit,
        need: Math.round(r.qty_consumed_base * 1000) / 1000,
        have: Math.round(Number(stock) * 1000) / 1000,
      });
    }
  }

  const costTotal = results.reduce((s, r) => s + r.cost, 0);
  return {
    units,
    totalKg: Math.round(totalKg * 1000) / 1000,
    lines: results,
    costTotal: Math.round(costTotal * 100) / 100,
    costPerUnit: units > 0 ? Math.round((costTotal / units) * 10000) / 10000 : 0,
    missing,
  };
}
