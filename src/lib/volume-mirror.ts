import {
  applyVolumePricing,
  type VolumeGroupInput,
  type VolumeResult,
} from "@/lib/volume-pricing";
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
    return {
      offerId: i.offerId,
      qty: i.qty,
      listUnit: Number(i.origPrice ?? i.price),
      promoUnit: hasPromo ? Number(i.price) : null,
      modsUnit: mods,
      refUnit: Number(i.price) + mods,
      hasPromo,
      excluded: i.cashExcluded,
    };
  });

  return applyVolumePricing(volLines, volGroups);
}
