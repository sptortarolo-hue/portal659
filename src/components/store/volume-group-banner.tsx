"use client";

type BannerGroup = {
  id: string;
  name: string;
  productIds: string[];
  memberNames?: string[];
  tiers: { minQty: number; kind: "fixed_total" | "percent_off"; value: number }[];
};

/**
 * Descubrimiento de combinables: un banner por grupo multi-producto para que
 * el cliente vea QUÉ se combina antes de agregar nada al carrito.
 * (VolumeProgress solo aparece cuando ya hay ítems en el carrito.)
 */
export function VolumeGroupBanner({ groups }: { groups: BannerGroup[] }) {
  const multi = (groups || []).filter(
    (g) => (g.memberNames || g.productIds || []).length > 1 && (g.tiers || []).length > 0
  );
  if (multi.length === 0) return null;

  return (
    <div className="space-y-2 my-3">
      {multi.map((g) => {
        const tier = [...g.tiers].sort((a, b) => a.minQty - b.minQty)[0];
        const tierText =
          tier.kind === "fixed_total"
            ? `Llevá ${tier.minQty} y pagá $${Number(tier.value).toLocaleString("es-AR")}`
            : `${tier.minQty}+ con ${Number(tier.value).toLocaleString("es-AR")}% off`;
        const names = (g.memberNames || []).filter(Boolean);
        return (
          <div key={g.id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-emerald-900">
              🧊 Armalo surtido: {g.name}
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">{tierText} · se combinan entre sí</p>
            {names.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {names.map((n) => (
                  <span
                    key={n}
                    className="text-[11px] font-medium text-emerald-900 bg-white border border-emerald-200 rounded-full px-2 py-0.5"
                  >
                    {n}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
