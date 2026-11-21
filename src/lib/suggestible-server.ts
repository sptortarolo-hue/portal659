// Helper server-side para "productos sugeribles" del carrito.
// Un producto es elegible si puede agregarse con un solo tap: sin opciones
// obligatorias/opcionales, no combo, no raíz con presentaciones activas,
// no parte de un grupo de volumen, no giftcard. Las presentaciones
// (parent_id IS NOT NULL) sí son elegibles.
import { queryMany, queryOne } from "@/lib/db";

export type SuggestibleContext = {
  modifiersByProduct: Map<string, number>; // product_id -> count de modifiers
  comboProductIds: Set<string>;
  volumeGroupProductIds: Set<string>;
  rootsWithPresentations: Set<string>; // raíces que tienen hijos disponibles
  giftProductIds: Set<string>;
};

export async function loadSuggestibleContext(vendorId: string): Promise<SuggestibleContext> {
  const modifiersByProduct = new Map<string, number>();
  const comboProductIds = new Set<string>();
  const volumeGroupProductIds = new Set<string>();
  const rootsWithPresentations = new Set<string>();
  const giftProductIds = new Set<string>();

  // Modifiers (cuenta por producto)
  try {
    const rows = await queryMany<{ product_id: string; c: number }>(
      `SELECT product_id, count(*)::int AS c FROM product_modifiers WHERE product_id IN (SELECT id FROM products WHERE vendor_id = $1) GROUP BY product_id`,
      [vendorId]
    );
    for (const r of rows || []) modifiersByProduct.set(String(r.product_id), Number(r.c) || 0);
  } catch { /* sin tabla: vacío */ }

  // Combos
  try {
    const rows = await queryMany<{ combo_product_id: string }>(
      `SELECT combo_product_id FROM combo_items WHERE vendor_id = $1`,
      [vendorId]
    );
    for (const r of rows || []) comboProductIds.add(String(r.combo_product_id));
  } catch { /* sin tabla: vacío */ }

  // Grupos de volumen
  try {
    const rows = await queryMany<{ product_ids: string[] | null }>(
      `SELECT product_ids FROM volume_groups WHERE vendor_id = $1 AND active = true`,
      [vendorId]
    );
    for (const r of rows || []) {
      const ids = Array.isArray(r.product_ids) ? r.product_ids : [];
      for (const id of ids) volumeGroupProductIds.add(String(id));
    }
  } catch { /* sin tabla: vacío */ }

  // Raíces con presentaciones disponibles
  try {
    const rows = await queryMany<{ parent_id: string }>(
      `SELECT DISTINCT parent_id FROM products WHERE vendor_id = $1 AND parent_id IS NOT NULL AND available = true`,
      [vendorId]
    );
    for (const r of rows || []) if (r.parent_id) rootsWithPresentations.add(String(r.parent_id));
  } catch { /* sin columna: vacío */ }

  // Gift cards (por sku/categoría)
  try {
    const rows = await queryMany<{ id: string; sku: string | null; category: string | null }>(
      `SELECT id, sku, category FROM products WHERE vendor_id = $1`,
      [vendorId]
    );
    for (const r of rows || []) {
      const isGift =
        String(r.sku || "").startsWith("GC-") ||
        String(r.category || "").trim().toLowerCase() === "giftcards";
      if (isGift) giftProductIds.add(String(r.id));
    }
  } catch { /* vacío */ }

  return { modifiersByProduct, comboProductIds, volumeGroupProductIds, rootsWithPresentations, giftProductIds };
}

export function isEligible(product: any, ctx: SuggestibleContext): { eligible: boolean; reason: string | null } {
  const id = String(product.id);
  if (product.available !== true && product.available !== "t") {
    // available puede ser boolean o string según el driver; toleramos ambos
  }
  if (product.available === false) return { eligible: false, reason: "No disponible" };

  // Modifiers (requeridos u opcionales): no sugerible
  const modCount = ctx.modifiersByProduct.get(id) || 0;
  if (modCount > 0) {
    return { eligible: false, reason: "Tiene opciones/modificadores" };
  }

  // Combo
  if (ctx.comboProductIds.has(id)) {
    return { eligible: false, reason: "Es un combo" };
  }

  // Gift card
  if (ctx.giftProductIds.has(id)) {
    return { eligible: false, reason: "Es tarjeta de regalo" };
  }

  // Grupo de volumen
  if (ctx.volumeGroupProductIds.has(id)) {
    return { eligible: false, reason: "Parte de un grupo de volumen" };
  }

  const isPresentation = product.parent_id != null && String(product.parent_id).trim() !== "";

  // Raíz con presentaciones activas: no sugerible (sugerir presentación)
  if (!isPresentation && ctx.rootsWithPresentations.has(id)) {
    return { eligible: false, reason: "Tiene presentaciones: sugerí una presentación específica" };
  }

  // Presentación huérfana (padre no existe): no sugerible
  if (isPresentation) {
    // el padre debe estar disponible; si el padre está en rootsWithPresentations... ok
    // no hay check adicional aquí; el endpoint filtra por available del padre si se desea
  }

  return { eligible: true, reason: null };
}

export async function hasSuggestibleColumn(): Promise<boolean> {
  const r = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'suggestible') AS exists`
  ).catch(() => ({ exists: false }));
  return r?.exists === true;
}
