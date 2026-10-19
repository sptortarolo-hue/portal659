/**
 * Variantes (color × talle): helpers client-safe para variantes de UNA sola
 * dimensión (cartera con varios colores sin talles, producto de un talle con
 * varios colores). La DB guarda "" en los vacíos (NOT NULL), el estado de los
 * selectores arranca en null: comparamos normalizado (null ≡ "").
 */

/** Color/talle de una variante como strings vacíos (nunca null). */
export type VariantDims = { color?: string | null; talle?: string | null };

/** Compara dos valores de dimensión con null ≡ "". */
export function dimEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/** true si la variante matchea la combinación elegida (cualquier dimensión
 * puede quedar "sin valor": cuenta como comodín = única de su lado). */
export function variantMatches(
  v: VariantDims,
  color: string | null | undefined,
  talle: string | null | undefined
): boolean {
  return dimEq(v.color, color) && dimEq(v.talle, talle);
}

/** " (Rojo)" / " (Rojo · M)" — solo con valores presentes; vacío → "". */
export function dimSuffix(color: string | null | undefined, talle: string | null | undefined): string {
  const trait = [color, talle]
    .filter((s) => s != null && String(s).trim() !== "")
    .map((s) => String(s).trim())
    .join(" · ");
  return trait ? ` (${trait})` : "";
}
