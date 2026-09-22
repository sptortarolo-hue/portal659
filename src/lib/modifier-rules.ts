/**
 * Lectura EFECTIVA de modificadores por producto (solo server: rutas API y
 * `resolveOrderPricing`). Resuelve el override por link:
 *
 *   efectivo = COALESCE(link.max/min_selections, grupo.max/min_selections)
 *
 * Caso heladería: un solo grupo "Gustos" con distinto N por tamaño
 * (1/4 → 2, 1/2 → 3, 1 kg → 5) sin duplicar la lista de gustos.
 *
 * Tolerante a migraciones pendientes: si faltan las columnas de
 * migrate-link-overrides.sql o migrate-min-selections.sql, cae al nivel
 * anterior en vez de romper. Solo propaga errores que NO son "columna
 * inexistente" (código pg 42703).
 */

export type EffectiveModifierRow = {
  id: string;
  group_name: string;
  options: { label?: string; price_mod?: number; category?: string; available?: boolean }[];
  required: boolean;
  max_selections: number;
  /** Puede venir undefined si la migración de min aún no se aplicó (= legacy). */
  min_selections?: number | null;
  is_variant: boolean;
  product_id: string;
  position: number;
};

export function isMissingColumnError(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (String(code ?? "") === "42703") return true;
  return /column .* does not exist/i.test(String((e as Error)?.message || ""));
}

export async function queryEffectiveModifiers(
  queryFn: <T extends Record<string, unknown>>(sql: string, params: unknown[]) => Promise<T[]>,
  productIds: string[]
): Promise<EffectiveModifierRow[]> {
  if (!productIds.length) return [];
  const from = `FROM product_modifier_links l
    JOIN modifier_groups g ON g.id = l.group_id
    WHERE l.product_id = ANY($1)
    ORDER BY g.is_variant DESC, l.position ASC`;
  const attempts = [
    // Nivel 1: overrides por link + min del grupo.
    `SELECT g.id, g.group_name, g.options, g.required,
            COALESCE(l.max_selections, g.max_selections) AS max_selections,
            COALESCE(l.min_selections, g.min_selections) AS min_selections,
            g.is_variant, l.product_id, l.position ${from}`,
    // Nivel 2: sin overrides (migración de links pendiente).
    `SELECT g.id, g.group_name, g.options, g.required, g.max_selections, g.min_selections,
            g.is_variant, l.product_id, l.position ${from}`,
    // Nivel 3: sin min (migración de min pendiente).
    `SELECT g.id, g.group_name, g.options, g.required, g.max_selections,
            g.is_variant, l.product_id, l.position ${from}`,
  ];
  for (const sql of attempts) {
    try {
      const rows = await queryFn<EffectiveModifierRow>(sql, [productIds]);
      return rows || [];
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
    }
  }
  return [];
}
