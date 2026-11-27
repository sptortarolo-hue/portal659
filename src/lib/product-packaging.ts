/**
 * Empaque por producto (comercio de barrio) — helpers sin dependencias de
 * servidor, usables desde el panel, el asistente de precios y los scripts.
 *
 * Regla de oro: `cost_last` sigue siendo "lo que pagás por el PRODUCTO".
 * El empaque vive en `packaging_cost` (derivado de los insumos elegidos) y
 * se SUMA recién cuando se calcula el costo efectivo. Así una compra o un
 * "Aplicar como costo" nunca te borra el empaque.
 *
 * Costo efectivo = cost_last + packaging_cost
 *   ...salvo en `in_recipe` (envasado desde granel), donde el empaque ya
 *   está dentro de cost_last y NO se suma dos veces.
 *
 * El empaque puede venir de un override del producto (`simple`) o del
 * default de su categoría (`category`). Se carga una sola vez por categoría.
 *
 * La migración es `supabase/self-host/migrate-product-packaging.sql`.
 */

export type PackagingMode = "none" | "category" | "simple" | "in_recipe";

export type PackagingCostRow = {
  cost_last?: number | null;
  packaging_cost?: number | null;
  packaging_mode?: PackagingMode | string | null;
};

export type PackagingLine = {
  ingredient_id: string;
  name: string;
  qty: number;
  unit_cost: number;
  base_unit?: string | null;
};

export type PackagingLineInput = { ingredient_id: string; qty: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PACKAGING_LINES = 20;

export function readPackagingMode(value: unknown): PackagingMode {
  return value === "simple" || value === "category" || value === "in_recipe" || value === "none"
    ? value
    : "none";
}

/**
 * Costo de empaque ya incluido en el producto (0 si no aplica).
 * 'category' también cuenta: el trigger ya resolvió el default de la
 * categoría y lo dejó en packaging_cost.
 */
export function packagingCostOf(p: PackagingCostRow): number {
  const mode = readPackagingMode(p.packaging_mode);
  if (mode !== "simple" && mode !== "category") return 0;
  const c = Number(p.packaging_cost);
  return Number.isFinite(c) && c > 0 ? c : 0;
}

/**
 * Costo que deben usar TODAS las fórmulas de precio y margen.
 * null = no hay costo de producto (no se inventa uno con el empaque).
 */
export function effectiveCostOf(p: PackagingCostRow): number | null {
  const c = p.cost_last == null ? NaN : Number(p.cost_last);
  if (!Number.isFinite(c) || c < 0) return null;
  return Math.round((c + packagingCostOf(p)) * 10000) / 10000;
}

/**
 * Variante para filas que ya vienen de la DB con `packaging_cost` derivado
 * (el trigger lo pone en 0 cuando el modo no es 'simple'). No vuelve a
 * chequear el modo: es el mismo número que usa `effectiveCostOf`.
 */
export function effectiveCostFromDb(p: {
  cost_last?: number | null;
  packaging_cost?: number | null;
}): number | null {
  const c = p.cost_last == null ? NaN : Number(p.cost_last);
  if (!Number.isFinite(c) || c < 0) return null;
  const pk = Number(p.packaging_cost);
  const extra = Number.isFinite(pk) && pk > 0 ? pk : 0;
  return Math.round((c + extra) * 10000) / 10000;
}

/** Suma de líneas con el costo unitario vigente (para preview en el panel). */
export function sumPackagingLines(lines: Pick<PackagingLine, "qty" | "unit_cost">[]): number {
  return Math.round(
    (lines || []).reduce((acc, l) => {
      const q = Number(l?.qty);
      const c = Number(l?.unit_cost);
      return acc + (Number.isFinite(q) && q > 0 && Number.isFinite(c) && c >= 0 ? q * c : 0);
    }, 0) * 10000
  ) / 10000;
}

/** Texto corto para el desglose: "Bolsa $80 · Etiqueta $30". */
export function packagingLineLabel(l: Pick<PackagingLine, "name" | "qty" | "unit_cost">): string {
  const q = Number(l.qty);
  const prefix = Number.isFinite(q) && q !== 1 ? `${trim(q)}× ` : "";
  return `${prefix}${l.name || "Empaque"} $${trim(Number(l.unit_cost) || 0)}`;
}

export function packagingModeLabel(mode: unknown): string {
  const m = readPackagingMode(mode);
  return m === "in_recipe"
    ? "Incluido en el lote de envasado"
    : m === "category"
      ? "Heredado de la categoría"
      : m === "simple"
        ? "Empaque cargado"
        : "Sin empaque";
}

/** Normaliza la clave de categoría usada en la tabla de defaults. */
export function categoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** Validación compartida por la API y la UI antes de guardar. */
export function normalizePackagingLines(value: unknown):
  | { ok: true; lines: PackagingLineInput[] }
  | { ok: false; error: string } {
  if (value == null) return { ok: true, lines: [] };
  if (!Array.isArray(value)) return { ok: false, error: "Las líneas de empaque deben ser una lista" };
  if (value.length > MAX_PACKAGING_LINES) {
    return { ok: false, error: `Como máximo ${MAX_PACKAGING_LINES} insumos de empaque por producto` };
  }
  const seen = new Set<string>();
  const lines: PackagingLineInput[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") return { ok: false, error: "Línea de empaque inválida" };
    const id = String(raw.ingredient_id ?? raw.ingredientId ?? "").trim();
    if (!UUID_RE.test(id)) return { ok: false, error: "Insumo de empaque inválido" };
    if (seen.has(id)) return { ok: false, error: "Un mismo insumo no puede repetirse" };
    seen.add(id);
    const qty = Number(raw.qty ?? 1);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99999) {
      return { ok: false, error: "La cantidad de empaque debe ser mayor a 0" };
    }
    lines.push({ ingredient_id: id, qty: Math.round(qty * 1000) / 1000 });
  }
  return { ok: true, lines };
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
