/**
 * Combo: validar/mergear las selecciones del cliente al pedir (server-side).
 * El cliente manda por componente una UTILIDAD distinta a las variantes del
 * producto, la validación mantiene las cantidades que el combo definió.
 */
import type { Tx } from "@/lib/db";
import { comboMemberName, type ComboMemberRow } from "@/lib/combo";

export type ComboDefRow = {
  /** ID en DB del producto miembro. */
  product_id: string;
  name: string;
  /** Unidades del componente que pide el combo (de combo_items). */
  qty: number;
  /** true si el componente se vende por variante (tiene filas en product_variants). */
  hasVariants?: boolean;
};

type IncomingMember = { product_id?: unknown; variant_id?: unknown; qty?: unknown };

export type ComboVariantRow = {
  id: string;
  product_id: string;
  color: string | null;
  talle: string | null;
};

const isUuid = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Resuelve el snapshot `combo_members` del ítem:
 *  - Sin selecciones del cliente: devuelve las clases de combo_items tal cual
 *    (compatibilidad con bot / MP / canales viejos). Si algún componente
 *    necesita variante, devuelve ok:false (el pedido necesita la selección).
 *  - Con selecciones: valida pertenencia (variante del producto del combo, del
 *    mismo local) y cuadre de cantidades, y arma el nombre con variante.
 */
export function resolveComboMembers(opts: {
  defs: ComboDefRow[];
  variantRows: ComboVariantRow[];
  comboName: string;
  selections: unknown;
  /** El canal mandó el campo (aunque sea vacío) — mantiene el flujo estricto. */
  sent?: boolean;
}): { ok: true; members: ComboMemberRow[] } | { ok: false; error: string } {
  const defs = opts.defs || [];
  if (defs.length === 0) return { ok: true, members: [] };

  const variantsByProduct = new Map<string, ComboVariantRow[]>();
  for (const v of opts.variantRows || []) {
    const key = String(v.product_id);
    if (!variantsByProduct.has(key)) variantsByProduct.set(key, []);
    variantsByProduct.get(key)!.push(v);
  }
  for (const d of defs) d.hasVariants = (variantsByProduct.get(d.product_id) || []).length > 0;

  const defById = new Map(defs.map((d) => [d.product_id, d]));
  const missing: string[] = defs.filter((d) => d.hasVariants).map((d) => d.name);

  if (!opts.sent || opts.selections == null) {
    // Canal viejo (bot / MP webhook / flows sin armado): sin selecciones.
    // Violación solo si algún componente se vende por variante.
    if (missing.length > 0) {
      const list = missing.map((n) => `"${n}"`).join(", ");
      return {
        ok: false,
        error: `Para el combo "${opts.comboName}" falta elegir talle y color de ${list}.`,
      };
    }
    return { ok: true, members: defs.map((d) => ({ product_id: d.product_id, name: d.name, qty: d.qty })) };
  }

  // Con selecciones: se valida cada pieza (pertenencia + cuadre).
  const raw = Array.isArray(opts.selections) ? (opts.selections as IncomingMember[]) : [];
  if (raw.length === 0) {
    if (missing.length > 0) {
      const list = missing.map((n) => `"${n}"`).join(", ");
      return {
        ok: false,
        error: `Para el combo "${opts.comboName}" falta elegir talle y color de ${list}.`,
      };
    }
    return { ok: true, members: defs.map((d) => ({ product_id: d.product_id, name: d.name, qty: d.qty })) };
  }

  type SlotRow = ComboMemberRow;
  const rows: SlotRow[] = [];
  const sums = new Map<string, number>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const pid = r.product_id;
    if (!isUuid(pid) || !defById.has(pid)) {
      return {
        ok: false,
        error: `El combo "${opts.comboName}" cambió (un componente ya no existe). Refrescá y volvé a intentar.`,
      };
    }
    const def = defById.get(pid)!;
    const q = Math.max(1, Math.min(99, Math.floor(Number(r.qty) || 1)));
    const vid = r.variant_id;
    if (def.hasVariants) {
      if (!isUuid(vid)) {
        return { ok: false, error: `Elegí talle y color de "${def.name}" para el combo "${opts.comboName}".` };
      }
      const v = (variantsByProduct.get(pid) || []).find((vv) => vv.id === vid);
      if (!v) {
        return { ok: false, error: `Esa variante de "${def.name}" no pertenece al combo "${opts.comboName}".` };
      }
      rows.push({
        product_id: pid,
        variant_id: v.id,
        color: v.color || null,
        talle: v.talle || null,
        name: comboMemberName({ name: def.name, color: v.color, talle: v.talle }),
        qty: q,
      });
    } else {
      rows.push({ product_id: pid, name: def.name, qty: q });
    }
    sums.set(pid, (sums.get(pid) || 0) + q);
  }

  for (const d of defs) {
    const got = sums.get(d.product_id) || 0;
    if (d.hasVariants && got === 0) {
      return { ok: false, error: `Elegí talle y color de "${d.name}" para el combo "${opts.comboName}".` };
    }
    if (got !== d.qty) {
      return {
        ok: false,
        error:
          got > 0
            ? `El combo "${opts.comboName}" pide ${d.qty} de "${d.name}" y llegaron ${got}.`
            : `Para el combo "${opts.comboName}" falta elegir ${d.qty} de "${d.name}".`,
      };
    }
  }

  return { ok: true, members: rows };
}
