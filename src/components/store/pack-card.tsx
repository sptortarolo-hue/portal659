"use client";

import { Package } from "lucide-react";
import { openPack } from "@/components/store/pack-sheet";
import { ProductImage } from "@/components/product-image";

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
  tiers: { minQty: number; kind: "fixed_total" | "percent_off" | "unit_price"; value: number }[];
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
  const members = (group.members || []).slice(0, 4);
  const tierText =
    tier.kind === "fixed_total"
      ? `Pack x${tier.minQty} · $${Number(tier.value).toLocaleString("es-AR")}`
      : tier.kind === "unit_price"
        ? `Desde x${tier.minQty}+ · $${Number(tier.value).toLocaleString("es-AR")} c/u`
        : `Pack x${tier.minQty}+ · ${Number(tier.value).toLocaleString("es-AR")}% off`;

  return (
    <button
      type="button"
      onClick={() => openPack(group.id)}
      className="pv2-card w-full text-left p-3"
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
          <p className="pv2-title text-sm line-clamp-2">
            <Package className="inline h-4 w-4 align-[-3px] mr-1 pv2-icon-accent" /> {group.name}
          </p>
          {members.length > 0 && (
            <p className="pv2-subtitle text-[11px] mt-0.5 truncate">
              Incluye: {members.map((m) => m.name).join(" · ")}
            </p>
          )}
          <p className="pv2-chip mt-1 w-fit">{tierText} · combinables entre sí</p>
        </div>
        <span className="pv2-chip flex-shrink-0">
          Armalo →
        </span>
      </div>
    </button>
  );
}
