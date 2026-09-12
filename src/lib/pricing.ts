import type { Tx } from "@/lib/db";
import type { OrderItem } from "@/types/database";
import { cashAppliesToItem, cashPrice, normalizeCashPct } from "@/lib/cash-discount";

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
        `SELECT id, name, price, promo_price, available, cash_discount_excluded FROM products
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

  const outItems: OrderItem[] = [];
  let subtotal = 0;
  let cashDiscount = 0;

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

    // Descuento en efectivo: sobre la unidad elegible (promo excluida no corre).
    // La unidad con descuento es la misma que muestra el micrositio.
    const hasPromo = variant ? variant.promo != null : product.promo_price != null;
    if (
      cashActive &&
      cashAppliesToItem({ hasPromo, excluded: product.cash_discount_excluded })
    ) {
      const unitCash = cashPrice(unit, cashPct);
      cashDiscount += round2((unit - unitCash) * qtySafe);
    }

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

  const fee = method === "delivery" ? Number(opts.deliveryFee) || 0 : 0;
  const freeMin = Number(opts.freeDeliveryMin) || 0;
  const deliveryFee = fee > 0 && !(freeMin > 0 && subtotal >= freeMin) ? fee : 0;

  // El descuento va solo sobre productos (nunca sobre el envío).
  cashDiscount = round2(Math.min(cashDiscount, subtotal));

  return {
    items: outItems,
    subtotal: round2(subtotal),
    deliveryFee: round2(deliveryFee),
    total: round2(subtotal - cashDiscount + deliveryFee),
    cashDiscount,
    cashPct: cashActive ? cashPct : 0,
  };
}
