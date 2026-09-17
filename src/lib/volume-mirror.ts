import {
  applyVolumePricing,
  type VolumeGroupInput,
  type VolumeResult,
} from "@/lib/volume-pricing";
import { cartLineTotal } from "@/lib/order-line";
import type { CartItem, CartVolumeGroup } from "@/lib/cart";

/**
 * Espejo visual del descuento por volumen para carrito/checkout.
 * El servidor recalcula y manda (resolveOrderPricing); esto es solo display.
 */
export function mirrorVolume(items: CartItem[], groups?: CartVolumeGroup[] | null): VolumeResult {
  const empty: VolumeResult = { volumeDiscount: 0, lines: [], applied: [] };
  if (!groups || groups.length === 0 || !items || items.length === 0) return empty;

  const volGroups: VolumeGroupInput[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    productIds: g.productIds || [],
    active: true,
    combinePromo: !!g.combinePromo,
    combineCash: !!g.combineCash,
    extrasIncluded: !!g.extrasIncluded,
    tiers: (g.tiers || []).map((t) => ({ minQty: t.minQty, kind: t.kind, value: t.value })),
  }));

  const volLines = items.map((i) => {
    const mods = (i.modifiers || []).reduce((s, m) => s + Number(m.price_mod || 0), 0);
    const hasPromo = i.hasPromo ?? (i.origPrice != null && Number(i.origPrice) !== Number(i.price));
    const pk = i.packSize && i.packSize >= 2 ? i.packSize : 1;
    // Pack: unidades full-precision (nunca round2 intermedio) — el espejo
    // matchea al server porque ambos calculan con la misma fórmula.
    const packList = i.origPrice != null && pk > 1 ? Number(i.origPrice) : null;
    return {
      offerId: i.offerId,
      qty: i.qty,
      listUnit: pk > 1 && packList != null ? packList / pk : Number(i.origPrice ?? i.price),
      promoUnit: hasPromo
        ? pk > 1 && i.packPrice != null
          ? i.packPrice / pk
          : Number(i.price)
        : null,
      modsUnit: mods,
      refUnit: cartLineTotal(i) / i.qty,
      hasPromo,
      excluded: i.cashExcluded,
    };
  });

  return applyVolumePricing(volLines, volGroups);
}
