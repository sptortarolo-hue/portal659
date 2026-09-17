import type { Tx } from "@/lib/db";
import type { OrderItem } from "@/types/database";
import { cashAppliesToItem, cashPrice, normalizeCashPct } from "@/lib/cash-discount";
import {
  applyVolumePricing,
  type VolumeGroupInput,
  type VolumeLineInput,
} from "@/lib/volume-pricing";

/** Interfaz mínima: sirve la Tx de withTransaction o un wrapper de queryMany. */
export type PricingQuerier = Pick<Tx, "query">;

export type IncomingOrderItem = {
  offerId?: string | null;
  variantId?: string | null;
  qty?: number | null;
  /** Labels de modificadores (los strings que vienen del carrito). */
  modifiers?: unknown;
};

/** Error de negocio al recomputar pedido (producto deshabilitado, modificador inválido, carrito vacío). */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

type ProductRow = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  available: boolean;
  cash_discount_excluded: boolean | null;
  /** Si se vende en packs (ej: 6), el precio es del paquete. NULL = por unidad. */
  pack_size: number | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  price: number;
  promo: number | null;
};

export type ResolvedPricing = {
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  /** Descuento en efectivo aplicado (0 si no corresponde). */
  cashDiscount: number;
  /** % aplicado (0 si no corresponde). */
  cashPct: number;
  /** Descuento por volumen aplicado (0 si no corresponde). */
  volumeDiscount: number;
  /** Grupos de volumen aplicados (para el mensaje de WhatsApp/ticket). */
  volumeApplied: { groupName: string; label: string; qty: number }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recalcula server-side los precios de un pedido: toma los precios reales de la
 * base de datos (productos/variantes + modificadores) y rehace el subtotal.
 * Nunca confiar en `item.price`/`total` del cliente: eso era vulnerable a
 * manipulación del request (un cliente podía declarar cualquier precio).
 *
 * Detecta:
 *  - producto/variante inexistente o de otro comercio,
 *  - modificadores que ya no existen,
 *  - subtotal/total que no coinciden con lo que envía el cliente (el cliente
 *    queda sobreescrito con el total real).
 */
export async function resolveOrderPricing(opts: {
  tx: PricingQuerier;
  vendorId: string;
  items: IncomingOrderItem[];
  method?: string | null;
  deliveryFee?: number | null;
  freeDeliveryMin?: number | null;
  /** Método de pago elegido (solo "efectivo" activa el descuento). */
  paymentMethod?: string | null;
  /** % de descuento en efectivo del comercio (0/NULL = sin descuento). */
  cashDiscountPct?: number | null;
}): Promise<ResolvedPricing> {
  const { tx, vendorId, method } = opts;
  const cashPct = normalizeCashPct(opts.cashDiscountPct);
  const cashActive = opts.paymentMethod === "efectivo" && cashPct > 0;

  if (!Array.isArray(opts.items) || opts.items.length === 0) {
    throw new PricingError("El pedido no tiene productos");
  }

  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const it of opts.items) {
    if (it?.offerId) productIds.add(String(it.offerId));
    if (it?.variantId) variantIds.add(String(it.variantId));
  }

  // Traigo variantes (necesitan su product_id para consultar el producto).
  const variants: VariantRow[] = variantIds.size
    ? await tx.query<VariantRow>(
        `SELECT pv.id, pv.product_id, pv.price, pv.promo
         FROM product_variants pv
         INNER JOIN products p ON p.id = pv.product_id
         WHERE pv.id = ANY($1) AND p.vendor_id = $2`,
        [[...variantIds], vendorId]
      )
    : [];

  // IDs de producto = los directos + los asociados a variantes.
  for (const v of variants) productIds.add(v.product_id);

  const products: ProductRow[] = productIds.size
    ? await tx.query<ProductRow>(
        `SELECT id, name, price, promo_price, available, cash_discount_excluded, pack_size FROM products
         WHERE vendor_id = $1 AND id = ANY($2)`,
        [vendorId, [...productIds]]
      )
    : [];

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  // Mapa product_id -> label -> price_mod (desde modifier_groups.options JSONB).
  let modifierMap = new Map<string, Map<string, number>>();
  if (productIds.size) {
    const modRows = await tx.query<{ product_id: string; options: { label?: string; price_mod?: number }[] }>(
      `SELECT l.product_id, g.options
       FROM product_modifier_links l
       JOIN modifier_groups g ON g.id = l.group_id
       WHERE l.product_id = ANY($1)`,
      [[...productIds]]
    );
    modifierMap = new Map();
    for (const row of modRows) {
      const opts = Array.isArray(row.options) ? row.options : [];
      let inner = modifierMap.get(row.product_id);
      if (!inner) {
        inner = new Map();
        modifierMap.set(row.product_id, inner);
      }
      for (const o of opts) {
        const label = String(o?.label ?? "").trim();
        if (!label) continue;
        inner.set(label, Number(o?.price_mod ?? 0) || 0);
      }
    }
  }

  type StagedLine = {
    product: ProductRow;
    variant?: VariantRow;
    unit: number;
    unitBase: number;
    modsTotal: number;
    qtySafe: number;
    labels: string[];
    hasPromo: boolean;
    /** Tamaño del pack (1 = por unidad). */
    pack: number;
  };

  const staged: StagedLine[] = [];
  const outItems: OrderItem[] = [];
  let subtotal = 0;

  for (const it of opts.items) {
    if (!it) continue;

    const qty = Number(it.qty);
    const qtySafe = Number.isFinite(qty) ? Math.min(99, Math.max(1, Math.floor(qty))) : 1;

    let product: ProductRow | undefined;
    let variant: VariantRow | undefined;

    if (it.variantId) {
      variant = variantById.get(String(it.variantId));
      if (variant) product = productById.get(variant.product_id);
    }
    if (!variant && it.offerId) {
      product = productById.get(String(it.offerId));
    }

    if (!product) {
      throw new PricingError(`Uno de los productos ya no está disponible (se actualizó el menú).`);
    }

    if (product.available === false) {
      throw new PricingError(`"${product.name}" ya no está disponible.`);
    }

    // Unidad base: promo de variante > promo de producto > precio.
    let unitPrice: number;
    if (variant) {
      unitPrice = variant.promo != null ? Number(variant.promo) : Number(variant.price);
    } else {
      unitPrice = product.promo_price != null ? Number(product.promo_price) : Number(product.price);
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new PricingError(`"Precio inválido en "${product.name}".`);
    }

    // Packs: si el producto se vende de a N (ej: sandwiches de miga x6), la
    // cantidad tiene que ser múltiplo de N y el precio del catálogo es del
    // PAQUETE → la unidad derivada = price / N (base para totales, volumen,
    // cash y modificadores por unidad).
    const pack =
      !variant && Number.isInteger(Number(product.pack_size)) && Number(product.pack_size) >= 2
        ? Math.floor(Number(product.pack_size))
        : 1;
    if (pack > 1) {
      if (qtySafe % pack !== 0) {
        throw new PricingError(
          `"${product.name}" se vende de a ${pack} unidades. Elegí una cantidad múltiplo de ${pack}.`
        );
      }
      unitPrice = round2(unitPrice / pack);
    }

    // Modificadores: solo se aplican los que el producto hoy tiene definidos
    // y con el precio actual del catálogo (no del cliente).
    const labels = Array.isArray(it.modifiers)
      ? it.modifiers.map((m) => String(m ?? "").trim()).filter(Boolean).slice(0, 10)
      : [];

    let unit = unitPrice;
    if (labels.length > 0) {
      const modsForProduct = modifierMap.get(product.id);
      for (const label of labels) {
        const mod = modsForProduct?.get(label);
        if (mod == null) {
          throw new PricingError(`Modificador "${label}" no existe más en "${product.name}".`);
        }
        unit += mod;
      }
    }

    unit = round2(unit);
    subtotal += unit * qtySafe;

    const hasPromo = variant ? variant.promo != null : product.promo_price != null;
    staged.push({
      product,
      variant,
      unit,
      unitBase: round2(unitPrice),
      modsTotal: round2(unit - unitPrice),
      qtySafe,
      labels,
      hasPromo,
      pack,
    });

    outItems.push({
      product_id: it.offerId ? String(it.offerId) : product.id,
      variant_id: variant ? variant.id : undefined,
      name: product.name,
      price: unit,
      qty: qtySafe,
      modifiers: labels.length ? labels : undefined,
    });
  }

  if (outItems.length === 0) {
    throw new PricingError("El pedido no tiene productos");
  }

  // Precios por volumen: agrupa líneas del mismo grupo (docena surtida) y
  // calcula el descuento a nivel pedido. Tolerante a tabla sin migrar.
  let volumeDiscount = 0;
  let volumeApplied: ResolvedPricing["volumeApplied"] = [];
  // Neto por línea tras volumen (para el cash con combine_cash).
  const volumeNetUnit = new Map<number, number>();
  const volumeNoCash = new Set<number>();
  try {
    const gRows = await tx.query<{
      id: string;
      name: string;
      product_ids: string[];
      combine_promo: boolean;
      combine_cash: boolean;
      extras_mode: string;
    }>(
      `SELECT id, name, product_ids, combine_promo, combine_cash, extras_mode
       FROM volume_groups WHERE vendor_id = $1 AND active = true ORDER BY position ASC, created_at ASC`,
      [vendorId]
    );
    if (gRows.length > 0) {
      const tRows = await tx.query<{ group_id: string; min_qty: number; kind: string; value: number }>(
        `SELECT group_id, min_qty, kind, value FROM volume_tiers WHERE group_id = ANY($1)`,
        [gRows.map((g) => g.id)]
      );
      const tiersByGroup = new Map<string, { minQty: number; kind: "fixed_total" | "percent_off"; value: number }[]>();
      for (const t of tRows) {
        if (t.kind !== "fixed_total" && t.kind !== "percent_off") continue;
        const arr = tiersByGroup.get(t.group_id) || [];
        arr.push({ minQty: Number(t.min_qty), kind: t.kind, value: Number(t.value) });
        tiersByGroup.set(t.group_id, arr);
      }
      const volGroups: VolumeGroupInput[] = gRows
        .map((g) => ({
          id: g.id,
          name: g.name,
          productIds: Array.isArray(g.product_ids) ? g.product_ids.map(String) : [],
          active: true,
          combinePromo: g.combine_promo === true,
          combineCash: g.combine_cash === true,
          extrasIncluded: g.extras_mode === "included",
          tiers: tiersByGroup.get(g.id) || [],
        }))
        .filter((g) => g.productIds.length > 0 && g.tiers.length > 0);
      if (volGroups.length > 0) {
        const volLines: VolumeLineInput[] = staged.map((s) => {
          const rawList = Number(s.variant ? s.variant.price : s.product.price);
          const rawPromo = s.variant
            ? s.variant.promo != null ? Number(s.variant.promo) : null
            : s.product.promo_price != null ? Number(s.product.promo_price) : null;
          // Con pack, la base del volumen es la unidad derivada (price/pack).
          const listUnit = s.pack > 1 ? round2(rawList / s.pack) : rawList;
          const promoUnit = s.pack > 1 && rawPromo != null ? round2(rawPromo / s.pack) : rawPromo;
          return {
            offerId: s.product.id,
            qty: s.qtySafe,
            listUnit,
            promoUnit,
            modsUnit: s.modsTotal,
            refUnit: s.unit,
            hasPromo: s.hasPromo,
            excluded: s.product.cash_discount_excluded,
          };
        });
        const vol = applyVolumePricing(volLines, volGroups);
        volumeDiscount = vol.volumeDiscount;
        volumeApplied = vol.applied.map((a) => ({ groupName: a.groupName, label: a.label, qty: a.qty }));
        vol.lines.forEach((l, i) => {
          if (l.netTotal !== l.grossTotal) {
            volumeNetUnit.set(i, round2(l.netTotal / staged[i].qtySafe));
          }
          if (!l.cashEligible) volumeNoCash.add(i);
        });
      }
    }
  } catch {
    // Tabla sin migrar: se sigue sin volumen.
    volumeDiscount = 0;
    volumeApplied = [];
    volumeNetUnit.clear();
    volumeNoCash.clear();
  }

  // Descuento en efectivo: sobre la unidad elegible (promo excluida no corre).
  // En líneas con volumen + combine_cash corre sobre el neto del grupo;
  // con volumen sin combine queda excluido.
  let cashDiscount = 0;
  if (cashActive) {
    staged.forEach((s, i) => {
      if (volumeNoCash.has(i)) return;
      if (!cashAppliesToItem({ hasPromo: s.hasPromo, excluded: s.product.cash_discount_excluded })) return;
      const cashUnit = volumeNetUnit.get(i) ?? s.unit;
      const unitCash = cashPrice(cashUnit, cashPct);
      cashDiscount += round2((cashUnit - unitCash) * s.qtySafe);
    });
  }

  const fee = method === "delivery" ? Number(opts.deliveryFee) || 0 : 0;
  const freeMin = Number(opts.freeDeliveryMin) || 0;
  // El volumen es precio real: el neto cuenta para el envío gratis
  // (el cash, en cambio, es medio de pago y no afecta el umbral).
  const netSubtotal = round2(subtotal - volumeDiscount);
  const deliveryFee = fee > 0 && !(freeMin > 0 && netSubtotal >= freeMin) ? fee : 0;

  // Los descuentos van solo sobre productos (nunca sobre el envío).
  cashDiscount = round2(Math.min(cashDiscount, netSubtotal));
  volumeDiscount = round2(Math.min(volumeDiscount, subtotal));

  return {
    items: outItems,
    subtotal: round2(subtotal),
    deliveryFee: round2(deliveryFee),
    total: round2(subtotal - volumeDiscount - cashDiscount + deliveryFee),
    cashDiscount,
    cashPct: cashActive ? cashPct : 0,
    volumeDiscount,
    volumeApplied,
  };
}
