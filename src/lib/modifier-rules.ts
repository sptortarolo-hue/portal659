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
  options: { label?: string; price_mod?: number; price_total?: number | null; promo?: number | null; category?: string; available?: boolean }[];
  required: boolean;
  max_selections: number;
  /** Puede venir undefined si la migración de min aún no se aplicó (= legacy). */
  min_selections?: number | null;
  is_variant: boolean;
  /** "diferencia" (default) o "total". Undefined si la migración aún no se aplicó (= diferencia). */
  price_mode?: string | null;
  product_id: string;
  position: number;
};

export function isMissingColumnError(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  if (String(code ?? "") === "42703") return true;
  return /column .* does not exist/i.test(String((e as Error)?.message || ""));
}

/**
 * Columna existe (information_schema nunca lanza: seguro dentro de una tx).
 * El reintento "probar y capturar" NO sirve dentro de una transacción: la
 * primera query aborta la tx (25P02) y todo lo posterior muere con
 * "current transaction is aborted, commands ignored".
 */
async function columnExists(
  queryFn: <T extends Record<string, unknown>>(sql: string, params: unknown[]) => Promise<T[]>,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await queryFn<{ e: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS e`,
    [table, column]
  );
  return rows[0]?.e === true;
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
  // Nivel 1: overrides por link + min del grupo + modo de precio.
  const nivel1 = `SELECT g.id, g.group_name, g.options, g.required,
            COALESCE(l.max_selections, g.max_selections) AS max_selections,
            COALESCE(l.min_selections, g.min_selections) AS min_selections,
            g.is_variant, g.price_mode, l.product_id, l.position ${from}`;
  // Nivel 2: sin overrides (migración de links pendiente).
  const nivel2 = `SELECT g.id, g.group_name, g.options, g.required, g.max_selections, g.min_selections,
            g.is_variant, g.price_mode, l.product_id, l.position ${from}`;
  // Nivel 3: sin min ni price_mode (migraciones de min/precio pendientes).
  const nivel3 = `SELECT g.id, g.group_name, g.options, g.required, g.max_selections,
            g.is_variant, l.product_id, l.position ${from}`;
  // Chequear las columnas una sola vez y elegir el nivel más alto soportado:
  // ninguna query fallida corre dentro de la transacción. Secuencial (mismo
  // client pg; information_schema es metadata, es despreciable).
  const linkMin = await columnExists(queryFn, "product_modifier_links", "min_selections");
  const linkMax = await columnExists(queryFn, "product_modifier_links", "max_selections");
  const gMin = await columnExists(queryFn, "modifier_groups", "min_selections");
  const gPriceMode = await columnExists(queryFn, "modifier_groups", "price_mode");
  if (linkMax && linkMin && gMin && gPriceMode) {
    return (await queryFn<EffectiveModifierRow>(nivel1, [productIds])) || [];
  }
  // Nivel 2 no toca columnas del link (usa los defaults del grupo).
  if (gMin && gPriceMode) {
    return (await queryFn<EffectiveModifierRow>(nivel2, [productIds])) || [];
  }
  // Nivel 3 siempre funciona (solo columnas de la migración base).
  return (await queryFn<EffectiveModifierRow>(nivel3, [productIds])) || [];
}
