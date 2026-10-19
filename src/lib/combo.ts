/**
 * Combo: tipos y helper de display (client-safe).
 * La variante elegida por componente viaja dentro del snapshot JSONB
 * `combo_members` del ítem del pedido (course per unit: cada pieza del combo
 * lleva su propia variante). Sin migración de DB.
 */
export type ComboMemberRow = {
  product_id: string;
  /** Nombre del componente (con " (Color · Talle)" si lleva variante). */
  name: string;
  /** Unidades de ESTA entrada. En armado por unidad: qty 1 por pieza (el
   * descuento de stock multiplica por la qty de la línea). */
  qty: number;
  variant_id?: string | null;
  color?: string | null;
  talle?: string | null;
};

/** "Remera Lisa (Blanca · M)" — para desglose de carrito, ticket, detalle. */
export function comboMemberName(m: {
  name?: string | null;
  color?: string | null;
  talle?: string | null;
}): string {
  const name = String(m?.name ?? "").trim() || "?";
  const trait = [m?.color, m?.talle]
    .filter((s) => s != null && String(s).trim() !== "")
    .map((s) => String(s).trim())
    .join(" · ");
  return trait ? `${name} (${trait})` : name;
}
