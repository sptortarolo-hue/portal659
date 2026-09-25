"use client";

import { openPack } from "@/components/store/pack-sheet";
import { ProductImage } from "@/components/product-image";
import { volumeGroupColor } from "@/lib/volume-pricing";

export type PackCardMember = {
  id: string;
  name: string;
  image?: string | null;
  price: number;
};

export type PackCardGroup = {
  id: string;
  name: string;
  productIds: string[];
  members?: PackCardMember[];
  tiers: { minQty: number; kind: "fixed_total" | "percent_off"; value: number }[];
};

/**
 * Tarjeta de pack en el catálogo: UN punto de entrada por pack.
 * Abre el armador (PackSheet). El precio y la regla van en la tarjeta;
 * el detalle vive en el sheet.
 */
export function PackCard({ group }: { group: PackCardGroup }) {
  const tiers = [...(group.tiers || [])].sort((a, b) => a.minQty - b.minQty);
  const tier = tiers[0];
  if (!tier) return null;
  const c = volumeGroupColor(group.id);
  const members = (group.members || []).slice(0, 4);
  const tierText =
    tier.kind === "fixed_total"
      ? `Pack x${tier.minQty} · $${Number(tier.value).toLocaleString("es-AR")}`
      : `Pack x${tier.minQty}+ · ${Number(tier.value).toLocaleString("es-AR")}% off`;

  return (
    <button
      type="button"
      onClick={() => openPack(group.id)}
      className={`w-full text-left rounded-2xl border p-3 ${c.border} ${c.soft} hover:shadow-md active:scale-[0.99] transition-all`}
    >
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2 flex-shrink-0">
          {members.map((m) => (
            <div key={m.id} className="h-10 w-10 rounded-full overflow-hidden border-2 border-white bg-accent">
              <ProductImage
                src={m.image || null}
                name={m.name}
                alt={m.name}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-bold leading-snug line-clamp-2 ${c.strong}`}>
            🧊 {group.name}
          </p>
          {members.length > 0 && (
            <p className={`text-[11px] mt-0.5 truncate ${c.text}`}>
              Incluye: {members.map((m) => m.name).join(" · ")}
            </p>
          )}
          <p className={`text-xs mt-0.5 font-semibold ${c.text}`}>{tierText} · combinables entre sí</p>
        </div>
        <span className={`text-xs font-bold px-3 py-2 rounded-xl ${c.solid} text-white flex-shrink-0`}>
          Armalo →
        </span>
      </div>
    </button>
  );
}
