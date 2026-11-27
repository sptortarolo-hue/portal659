// @ts-nocheck — pendiente de conversión a TypeScript.
// Contrato estricto entre el LLM y el carrito del bot.
// El modelo propone; acá se VALIDA antes de tocar el state:
//  - sólo entran ítems que existen en el menú real (por id o nombre),
//  - los datos de contacto nunca son un producto del catálogo,
//  - la operación (add/remove/setQty) la decide el mensaje, no el modelo.
// Nada de few-shot de "estados de tarea": eso rompió el flujo y fue revertido.

import { normalizeDraftItem, isValidDraftItem } from "./draft.mjs";

export const norm = (s) => String(s || "")
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** La operación surge del texto del cliente, con el LLM sólo como último recurso. */
export function resolveOperation(text, parsed) {
  const t = norm(text);
  if (/\b(sac[aá]|quitar|eliminar|borrar|sin lo anterior)\b/.test(t)) return "remove";
  if (/\b(solo|mejor|en vez de|en lugar de|reemplaz[aá]|cambi[aá] por)\b/.test(t)) return "setQty";
  if (/\b(agreg[aá]|agregar|agregame|sum[aá]|sumar|tambi[eé]n|adem[aá]s|otra?)\b/.test(t)) return "add";
  return parsed?.op === "remove" ? "remove" : parsed?.op === "setQty" ? "setQty" : "add";
}

function looksLikePersonName(value, products) {
  const s = String(value || "").trim();
  if (!s || s.length < 2 || s.length > 60) return false;
  if (!/[a-záéíóúñ]/i.test(s)) return false;
  const n = norm(s);
  // "sticker", "milanesa", "coca": son productos, no personas.
  return !products.some((p) => {
    const pn = norm(p.name);
    return pn === n || (n.length <= 14 && pn.includes(n));
  });
}

function looksLikeAddress(value, products) {
  const s = String(value || "").trim();
  if (!s || s.length > 140) return false;
  const n = norm(s);
  return !products.some((p) => n === norm(p.name));
}

/**
 * @param {object} parsed salida del LLM/reglas
 * @param {object} ctx { text, products, cart, pending }
 */
export function sanitizeParsed(parsed, ctx = {}) {
  if (!parsed) return parsed;
  const out = { ...parsed };
  const products = Array.isArray(ctx.products) ? ctx.products : [];
  const unknown = Array.isArray(parsed.unknownItems) ? [...parsed.unknownItems] : [];

  // 1) Ítems: sólo los que existen en el menú real.
  const items = [];
  for (const raw of parsed.items || []) {
    const it = normalizeDraftItem(raw);
    let offerId = String(it.offerId || "");
    const inMenu = products.find((p) => String(p.id) === offerId);
    if (!inMenu) {
      const said = norm(it.name || raw?.said || "");
      const byName = said.length >= 3
        ? products.find((p) => norm(p.name) === said || norm(p.name).includes(said))
        : null;
      if (byName) {
        offerId = String(byName.id);
        it.name = byName.name;
        it.price = byName.price ?? it.price;
      } else {
        if (it.name) unknown.push(it.name);
        continue; // basura: nunca entra al carrito
      }
    }
    it.offerId = offerId;
    if (isValidDraftItem(it)) items.push(it);
  }
  out.items = items;
  out.unknownItems = unknown;

  // 2) Datos de contacto: jamás un producto del catálogo.
  if (out.customerName && !looksLikePersonName(out.customerName, products)) {
    out.customerName = null;
  }
  if (out.customerAddress && !looksLikeAddress(out.customerAddress, products)) {
    out.customerAddress = null;
  }

  // 3) Operación: manda el mensaje del cliente.
  out.op = resolveOperation(ctx.text, parsed);
  return out;
}

/**
 * Aplica ítems al carrito SIN borrar lo que ya estaba.
 * Coincide por offerId+variante; si existe actualiza qty/campos, si no agrega.
 */
export function upsertItems(cart, items, op = "add") {
  const next = Array.isArray(cart) ? cart.map((i) => ({ ...i })) : [];
  for (const raw of items || []) {
    const it = normalizeDraftItem(raw);
    if (!isValidDraftItem(it)) continue;
    const idx = next.findIndex(
      (i) => String(i.offerId) === String(it.offerId) && (i.variantId || null) === (it.variantId || null)
    );
    if (idx >= 0) {
      const base = next[idx];
      // add suma cantidades; setQty (cliente dijo "solo/mejor") las reemplaza.
      const qty = op === "setQty" ? it.qty : Math.max(1, Number(base.qty || 0) + it.qty);
      next[idx] = {
        ...base,
        name: it.name || base.name,
        qty,
        price: it.price ?? base.price ?? null,
        unit: it.unit,
        weightKg: it.weightKg ?? base.weightKg ?? null,
        modifiers: it.modifiers?.length ? it.modifiers : (base.modifiers || []),
        comboMembers: it.comboMembers ?? base.comboMembers ?? null,
        note: it.note ?? base.note ?? null,
      };
    } else {
      next.push({
        offerId: it.offerId, variantId: it.variantId || null, name: it.name,
        qty: it.qty, price: it.price, unit: it.unit, weightKg: it.weightKg,
        modifiers: it.modifiers, comboMembers: it.comboMembers, note: it.note,
      });
    }
  }
  return next;
}
