// Draft único de ítems del bot de WhatsApp.
// Todo ítem que pase por el bot —sea del LLM, del fallback de reglas o del
// usuario escribiendo "agregá una coca"— pasa por normalizeDraftItem antes de
// llegar al carrito del estado o al endpoint de pedido.
// Reemplaza los 5 Math.max(1, ...) que hoy aplastaban kg/packs/variantes.

export const UNIT_UNIDAD = "unidad";
export const UNIT_KG = "kg";
export const UNIT_PACK = "pack";

/** Normaliza un ítem al contrato del micrositio:
 *  - unidad: qty entero >= 1
 *  - kg: qty = weightKg decimal (0 < qty <= 99)
 *  - pack: qty entero >= 1 (multiplo de pack_size se valida al cotizar/crear)
 *  - modifiers: array de strings o {group, label, price?}
 *  - comboMembers: array de {product_id, variant_id, qty}
 * Devuelve siempre qty >= 1. Nunca inventa unit/weightKg. */
export function normalizeDraftItem(item) {
  const unit = item.unit || UNIT_UNIDAD;
  let qty = Number(item.qty || 0);
  let weightKg = item.weightKg != null ? Number(item.weightKg) : null;

  if (unit === UNIT_KG) {
    if (weightKg != null && Number.isFinite(weightKg) && weightKg > 0 && weightKg <= 99) {
      qty = weightKg;
    } else if (qty > 0 && qty <= 99) {
      // Si no trae weightKg pero sí qty numérica dentro del rango, la usamos.
      qty = qty;
    } else {
      qty = 0;
    }
  } else if (unit === UNIT_PACK) {
    qty = Number.isFinite(qty) && qty > 0 ? Math.max(1, Math.floor(qty)) : 1;
  } else {
    qty = Number.isFinite(qty) && qty > 0 ? Math.max(1, Math.floor(qty)) : 1;
  }

  const modifiers = Array.isArray(item.modifiers) ? item.modifiers.map((m) => {
    if (typeof m === "string") return { label: m, group: null, price: null };
    return { label: m.label || m.name || "", group: m.group || null, price: m.price != null ? Number(m.price) : null };
  }) : [];

  const comboMembers = Array.isArray(item.comboMembers) ? item.comboMembers.map((cm) => ({
    product_id: cm.product_id || null,
    variant_id: cm.variant_id || null,
    qty: Number(cm.qty || 1) || 1,
  })) : null;

  return {
    name: item.name || null,
    offerId: item.offerId || item.id || null,
    variantId: item.variantId || null,
    price: item.price != null ? Number(item.price) : null,
    qty,
    unit,
    weightKg: unit === UNIT_KG ? weightKg : null,
    modifiers: modifiers.length ? modifiers : [],
    comboMembers,
    note: item.note || null,
  };
}

/** Valida que un ítem sea "envíable": tiene offerId y qty >= 1. */
export function isValidDraftItem(item) {
  return !!(item && item.offerId && Number(item.qty || 0) > 0);
}

/** Aplica un ítem draft a un array de carrito del estado del bot.
 *  Combina qty si el mismo producto+variante+modificadores ya existe.
 *  Devuelve el nuevo array (no muta si no hay cambios). */
export function applyDraftToCart(stateItems, draftItem) {
  const it = normalizeDraftItem(draftItem);
  if (!isValidDraftItem(it)) return stateItems || [];

  const key = `${it.offerId}|${it.variantId || ""}|${it.modifiers.map((m) => m.label || "").join(",")}`;
  const items = stateItems ? [...stateItems] : [];
  const existing = items.find((i) => {
    const k = `${i.offerId}|${i.variantId || ""}|${(i.modifiers || []).map((m) => (typeof m === "string" ? m : m.label)).join(",")}`;
    return k === key;
  });

  if (existing) {
    existing.qty = Math.max(1, Number(existing.qty || 0) + it.qty);
    return items;
  }
  items.push({ name: it.name, offerId: it.offerId, variantId: it.variantId, price: it.price, qty: it.qty, unit: it.unit, weightKg: it.weightKg, modifiers: it.modifiers, comboMembers: it.comboMembers, note: it.note });
  return items;
}

/** Quita un ítem del carrito por nombre fuzzy (mismo criterio que applyCartEdit). */
export function removeDraftFromCart(stateItems, search) {
  const items = stateItems ? [...stateItems] : [];
  const idx = findDraftItemIndex(items, search);
  if (idx === -1) return items;
  items.splice(idx, 1);
  return items;
}

function findDraftItemIndex(items, search) {
  const s = String(search || "").trim();
  if (!s || !items.length) return -1;
  const sn = normalizeLabel(s);
  let idx = items.findIndex((i) => normalizeLabel(i.name || "") === sn);
  if (idx !== -1) return idx;
  idx = items.findIndex((i) => {
    const n = normalizeLabel(i.name || "");
    return n.includes(sn) || sn.includes(n);
  });
  if (idx !== -1) return idx;
  const words = sn.split(/\s+/).filter((w) => w.length >= 3);
  return items.findIndex((i) => {
    const n = normalizeLabel(i.name || "");
    return words.some((w) => n.split(/\s+/).some((nw) => nw === w || nw.includes(w) || w.includes(nw)));
  });
}

function normalizeLabel(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
