/**
 * Precios por volumen (gastro): grupos mixtos de productos + tramos por cantidad.
 *
 * Módulo PURO (sin imports server/client): lo usan tanto `resolveOrderPricing`
 * (fuente de verdad server-side) como el micrositio/checkout (espejo visual).
 *
 * Semántica:
 *  - El grupo suma cantidades de DISTINTOS productos (docena surtida).
 *  - `fixed_total`: sets completos, greedy del tramo mayor; el resto a unidad
 *    (14 empanadas con pack de 12 = 12 a pack + 2 a unidad). Los sets cubren las
 *    unidades más caras primero.
 *  - `percent_off`: si se llega al tramo, TODO el grupo va con el mejor % alcanzado.
 *  - Si un grupo tiene tramos de ambos tipos, se aplica el que más descuenta.
 *  - Base de la unidad: `price` (o `promo` si `combinePromo`); los modificadores
 *    con costo se suman salvo `extrasIncluded` + tramo fijo (el pack los absorbe).
 *  - Orden fijo: volumen primero, efectivo después (solo si `combineCash`).
 */

export type VolumeTierKind = "fixed_total" | "percent_off";
export type VolumeExtrasMode = "on_top" | "included";

export type VolumeTierInput = {
  minQty: number;
  kind: VolumeTierKind;
  value: number;
};

export type VolumeGroupInput = {
  id: string;
  name: string;
  productIds: string[];
  active?: boolean;
  combinePromo: boolean;
  combineCash: boolean;
  /** true = extras con costo absorbidos por el pack fijo. */
  extrasIncluded: boolean;
  tiers: VolumeTierInput[];
};

export type VolumeLineInput = {
  offerId: string;
  qty: number;
  /** Precio base de catálogo (sin promo). */
  listUnit: number;
  /** Unidad con promo (null si no tiene). */
  promoUnit: number | null;
  /** Suma de price_mod de modificadores, por unidad. */
  modsUnit: number;
  /**
   * Unidad de referencia SIN volumen, como la resolvió el llamador
   * (server: promo ?? price + mods validados; cliente: price + mods del carrito).
   * El volumen solo se aplica si mejora este total (nunca deja más caro).
   */
  refUnit: number;
  hasPromo: boolean;
  excluded?: boolean | null;
};

export type VolumeLineResult = {
  offerId: string;
  qty: number;
  grossTotal: number;
  netTotal: number;
  groupId: string | null;
  groupName: string | null;
  /** ¿Puede correr cash sobre esta línea? Solo si el grupo que aplicó combina. */
  cashEligible: boolean;
  hasPromo: boolean;
  excluded?: boolean | null;
};

export type VolumeAppliedGroup = {
  groupId: string;
  groupName: string;
  qty: number;
  label: string;
};

export type VolumeResult = {
  volumeDiscount: number;
  lines: VolumeLineResult[];
  applied: VolumeAppliedGroup[];
};

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function fmtMoney(n: number): string {
  return `$${round2(n).toLocaleString("es-AR")}`;
}

/** Unidad bruta de la línea dentro del grupo (base + extras según flags). */
function grossUnitFor(line: VolumeLineInput, group: VolumeGroupInput, tierKind: VolumeTierKind): number {
  const base =
    group.combinePromo && line.promoUnit != null ? Number(line.promoUnit) : Number(line.listUnit);
  const mods = Number(line.modsUnit) || 0;
  // Sin round2 intermedio: los packs trabajan con unidad full-precision
  // (11500/6 = 1916,666… → ×6 = 11500 exacto tras el round2 de la línea).
  if (tierKind === "fixed_total" && group.extrasIncluded) return base;
  return base + mods;
}

/**
 * Base que el pack fijo cubre + extra que va por encima.
 * on_top: el pack cubre solo la base, los extras se cobran aparte.
 * included: el pack absorbe base + extras.
 */
function packSplitFor(
  line: VolumeLineInput,
  group: VolumeGroupInput
): { packUnit: number; extraUnit: number } {
  const base =
    group.combinePromo && line.promoUnit != null ? Number(line.promoUnit) : Number(line.listUnit);
  const mods = Number(line.modsUnit) || 0;
  if (group.extrasIncluded) return { packUnit: base + mods, extraUnit: 0 };
  return { packUnit: base, extraUnit: mods };
}

function packLabel(tier: VolumeTierInput): string {
  return tier.kind === "fixed_total"
    ? `${tier.minQty}x ${fmtMoney(tier.value)}`
    : `${tier.minQty}+ con ${Number(tier.value).toLocaleString("es-AR")}% off`;
}

/**
 * Aplica las reglas de volumen a un conjunto de líneas. No muta la entrada.
 * Los grupos se evalúan en el orden recibido (el llamador ordena por
 * position/created_at); un producto en dos grupos queda en el primero.
 */
export function applyVolumePricing(
  lines: VolumeLineInput[],
  groups: VolumeGroupInput[]
): VolumeResult {
  const results: VolumeLineResult[] = lines.map((l) => {
    const ref = round2(Number(l.refUnit) * l.qty);
    return {
      offerId: l.offerId,
      qty: l.qty,
      grossTotal: ref,
      netTotal: ref,
      groupId: null,
      groupName: null,
      cashEligible: true,
      hasPromo: l.hasPromo,
      excluded: l.excluded,
    };
  });

  const claimed = new Set<number>();
  const applied: VolumeAppliedGroup[] = [];
  let volumeDiscount = 0;

  for (const group of groups || []) {
    if (!group || group.active === false) continue;
    const tiers = [...(group.tiers || [])]
      .filter((t) => Number(t?.minQty) >= 2 && Number(t?.value) > 0)
      .sort((a, b) => Number(a.minQty) - Number(b.minQty));
    if (tiers.length === 0) continue;
    const memberSet = new Set((group.productIds || []).map(String));

    const idxs: number[] = [];
    lines.forEach((l, i) => {
      if (!claimed.has(i) && memberSet.has(String(l.offerId))) idxs.push(i);
    });
    if (idxs.length === 0) continue;
    for (const i of idxs) claimed.add(i);

    const groupQty = idxs.reduce((s, i) => s + lines[i].qty, 0);
    for (const i of idxs) {
      results[i].groupId = group.id;
      results[i].groupName = group.name;
    }

    const fixedTiers = tiers.filter((t) => t.kind === "fixed_total").sort((a, b) => b.minQty - a.minQty);
    const pctTiers = tiers.filter((t) => t.kind === "percent_off");

    // --- Estrategia A: sets fijos (greedy del tramo mayor) ---
    // unitIdx -> neto prorrateado (si gana fijo)
    let fixedNetByIdx = new Map<number, number>();
    let fixedLabel = "";
    if (fixedTiers.some((t) => groupQty >= t.minQty)) {
      // Expando unidades (valor cubierto por el pack) de mayor a menor: los
      // sets cubren las caras primero. Los extras on_top van por encima.
      const units: { idx: number; pack: number; extra: number }[] = [];
      for (const i of idxs) {
        const { packUnit, extraUnit } = packSplitFor(lines[i], group);
        for (let k = 0; k < lines[i].qty; k++) units.push({ idx: i, pack: packUnit, extra: extraUnit });
      }
      units.sort((a, b) => b.pack - a.pack);
      let cursor = 0;
      let packsValue = 0;
      let packsGross = 0;
      const usedTiers: VolumeTierInput[] = [];
      while (cursor < units.length) {
        const remaining = units.length - cursor;
        // El pack solo se toma si DESCUENTA (valor < bruto que cubre).
        const tier = fixedTiers.find((t) => {
          if (remaining < t.minQty) return false;
          const sliceGross = units
            .slice(cursor, cursor + t.minQty)
            .reduce((s, u) => s + u.pack, 0);
          return Number(t.value) < sliceGross;
        });
        if (!tier) break;
        const slice = units.slice(cursor, cursor + tier.minQty);
        packsGross += slice.reduce((s, u) => s + u.pack, 0);
        packsValue += Number(tier.value);
        usedTiers.push(tier);
        cursor += tier.minQty;
      }
      if (usedTiers.length > 0) {
        // Prorrateo del valor de los packs entre las unidades consumidas +
        // extras on_top por encima. Las no consumidas van a bruto completo.
        fixedNetByIdx = new Map<number, number>();
        const consumed = units.slice(0, cursor);
        for (const u of consumed) {
          const share = packsGross > 0 ? (u.pack / packsGross) * packsValue : 0;
          fixedNetByIdx.set(u.idx, round2((fixedNetByIdx.get(u.idx) || 0) + share + u.extra));
        }
        for (const i of idxs) {
          if (!fixedNetByIdx.has(i)) {
            const { packUnit, extraUnit } = packSplitFor(lines[i], group);
            fixedNetByIdx.set(i, round2((packUnit + extraUnit) * lines[i].qty));
          }
        }
        // Ajuste de redondeo: la suma de nets debe dar packsValue + resto + extras.
        const remainderGross = units.slice(cursor).reduce((s, u) => s + u.pack + u.extra, 0);
        const target = round2(packsValue + remainderGross + consumed.reduce((s, u) => s + u.extra, 0));
        const current = round2([...fixedNetByIdx.values()].reduce((s, v) => s + v, 0));
        const drift = round2(target - current);
        if (drift !== 0 && fixedNetByIdx.size > 0) {
          const firstKey = [...fixedNetByIdx.keys()][0];
          fixedNetByIdx.set(firstKey, round2((fixedNetByIdx.get(firstKey) || 0) + drift));
        }
        const bestTier = usedTiers.sort((a, b) => b.minQty - a.minQty)[0];
        fixedLabel = packLabel(bestTier);
      }
    }

    // --- Estrategia B: % sobre todo el grupo ---
    let pctNetByIdx = new Map<number, number>();
    let pctBest: VolumeTierInput | null = null;
    for (const t of pctTiers) {
      if (groupQty >= t.minQty && (!pctBest || t.minQty > pctBest.minQty)) pctBest = t;
    }
    if (pctBest) {
      const pct = Number(pctBest.value) / 100;
      for (const i of idxs) {
        const gross = round2(grossUnitFor(lines[i], group, "percent_off") * lines[i].qty);
        pctNetByIdx.set(i, round2(gross * (1 - pct)));
      }
    }

    // Gana la que más descuenta CONTRA la referencia sin volumen: el volumen
    // nunca deja el total más caro (si el pack es peor que la promo vigente,
    // no se aplica y el cash sigue corriendo normal).
    const refGross = round2(idxs.reduce((s, i) => s + results[i].grossTotal, 0));
    const fixedNetTotal = round2([...fixedNetByIdx.values()].reduce((s, v) => s + v, 0));
    const pctNetTotal = round2([...pctNetByIdx.values()].reduce((s, v) => s + v, 0));
    const fixedSaves = fixedNetByIdx.size > 0 ? round2(refGross - fixedNetTotal) : 0;
    const pctSaves = pctNetByIdx.size > 0 ? round2(refGross - pctNetTotal) : 0;
    if (fixedSaves <= 0 && pctSaves <= 0) continue;
    const useFixed = fixedSaves >= pctSaves;

    if (useFixed) {
      volumeDiscount = round2(volumeDiscount + fixedSaves);
      for (const i of idxs) results[i].netTotal = fixedNetByIdx.get(i) ?? results[i].grossTotal;
      applied.push({ groupId: group.id, groupName: group.name, qty: groupQty, label: fixedLabel });
    } else if (pctBest) {
      volumeDiscount = round2(volumeDiscount + pctSaves);
      for (const i of idxs) results[i].netTotal = pctNetByIdx.get(i) ?? results[i].grossTotal;
      applied.push({ groupId: group.id, groupName: group.name, qty: groupQty, label: packLabel(pctBest) });
    }

    // Sin combine_cash, el cash no corre sobre estas líneas.
    if (!group.combineCash) {
      for (const i of idxs) results[i].cashEligible = false;
    }
  }

  volumeDiscount = round2(volumeDiscount);
  return { volumeDiscount, lines: results, applied };
}

/** Tramos de un producto (para badges), ordenados por minQty asc. */
export function tiersForProduct(
  groups: VolumeGroupInput[],
  offerId: string
): { group: VolumeGroupInput; tiers: VolumeTierInput[] } | null {
  for (const g of groups || []) {
    if (!g || g.active === false) continue;
    if ((g.productIds || []).map(String).includes(String(offerId))) {
      const tiers = [...(g.tiers || [])]
        .filter((t) => Number(t?.minQty) >= 2 && Number(t?.value) > 0)
        .sort((a, b) => Number(a.minQty) - Number(b.minQty));
      if (tiers.length > 0) return { group: g, tiers };
    }
  }
  return null;
}

/** Texto corto del badge ("Llevá 6 y pagá $10.000"). Hasta 2 tramos. */
export function volumeBadgeText(
  groups: VolumeGroupInput[],
  offerId: string
): string | null {
  const found = tiersForProduct(groups, offerId);
  if (!found) return null;
  // Grupo multi-producto = combinable/surtido: se explicita para que el
  // cliente entienda que mezcla con otros antes de agregar al carrito.
  const mixed = (found.group.productIds || []).length > 1;
  const parts = found.tiers.slice(0, 2).map((t) =>
    t.kind === "fixed_total"
      ? mixed
        ? `${t.minQty} surtidos x ${fmtMoney(Number(t.value))}`
        : `Llevá ${t.minQty} y pagá ${fmtMoney(Number(t.value))}`
      : mixed
        ? `${t.minQty}+ surtidos con ${Number(t.value).toLocaleString("es-AR")}% off`
        : `${t.minQty}+ con ${Number(t.value).toLocaleString("es-AR")}% off`
  );
  return `📦 ${parts.join(" · ")}`;
}

/** Validación del payload del editor (API vendor). */
export function validateVolumeGroupPayload(body: any): { error?: string; value?: {
  name: string;
  productIds: string[];
  combinePromo: boolean;
  combineCash: boolean;
  extrasMode: VolumeExtrasMode;
  tiers: VolumeTierInput[];
} } {
  const name = String(body?.name ?? "").trim().slice(0, 60);
  if (!name) return { error: "Ponéle un nombre al grupo (ej: Empanadas)" };

  const rawIds: unknown[] = Array.isArray(body?.product_ids) ? body.product_ids : [];
  const productIds: string[] = [
    ...new Set(
      rawIds.map((x) => String((x as string) ?? "").trim()).filter((s) => s !== "")
    ),
  ];
  if (productIds.length === 0) return { error: "Tildá al menos un producto del grupo" };
  if (productIds.length > 50) return { error: "El grupo admite hasta 50 productos" };
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!productIds.every((id) => uuidRe.test(id))) return { error: "Hay productos inválidos en el grupo" };

  const rawTiers: unknown[] = Array.isArray(body?.tiers) ? body.tiers : [];
  if (rawTiers.length === 0) return { error: "Agregá al menos un tramo (cantidad + precio)" };
  if (rawTiers.length > 5) return { error: "Máximo 5 tramos por grupo" };
  const tiers: VolumeTierInput[] = [];
  const seen = new Set<number>();
  for (const t of rawTiers) {
    const tt = t as { min_qty?: unknown; kind?: unknown; value?: unknown };
    const minQty = Math.floor(Number(tt?.min_qty));
    const kind = tt?.kind === "percent_off" ? "percent_off" : "fixed_total";
    const value = Number(tt?.value);
    if (!Number.isFinite(minQty) || minQty < 2 || minQty > 99) {
      return { error: "La cantidad de cada tramo va de 2 a 99" };
    }
    if (seen.has(minQty)) return { error: `Hay dos tramos con cantidad ${minQty}` };
    seen.add(minQty);
    if (!Number.isFinite(value) || value <= 0) return { error: "El valor de cada tramo tiene que ser mayor a 0" };
    if (kind === "percent_off" && value > 90) return { error: "El % off no puede pasar el 90%" };
    tiers.push({ minQty, kind, value: Math.round(value * 100) / 100 });
  }
  tiers.sort((a, b) => a.minQty - b.minQty);

  const extrasMode: VolumeExtrasMode = body?.extras_mode === "included" ? "included" : "on_top";

  return {
    value: {
      name,
      productIds,
      combinePromo: body?.combine_promo === true,
      combineCash: body?.combine_cash === true,
      extrasMode,
      tiers,
    },
  };
}
