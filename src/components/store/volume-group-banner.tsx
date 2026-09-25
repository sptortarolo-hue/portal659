"use client";

import { useCart, type CartVendor } from "@/lib/cart";
import { ProductImage } from "@/components/product-image";

export type BannerMember = {
  id: string;
  name: string;
  image?: string | null;
  price: number;
};

export type BannerGroup = {
  id: string;
  name: string;
  productIds: string[];
  memberNames?: string[];
  /** Detalle para el cartel (foto + precio para quick-add). Lo arma el server. */
  members?: BannerMember[];
  tiers: { minQty: number; kind: "fixed_total" | "percent_off"; value: number }[];
};

/**
 * Cartel "Armá tu pack": por cada grupo multi-producto muestra la regla, los
 * miembros con foto/precio/botón + para agregar sin salir, y el contador en
 * vivo del carrito. El descuento lo calcula el servidor (espejo visual).
 */
export function VolumeGroupBanner({ groups, vendor }: { groups: BannerGroup[]; vendor: CartVendor }) {
  const { items, addItem, setQty } = useCart();

  const multi = (groups || []).filter(
    (g) => (g.members || g.memberNames || g.productIds || []).length > 1 && (g.tiers || []).length > 0
  );
  if (multi.length === 0) return null;

  return (
    <div className="space-y-2 my-3">
      {multi.map((g) => {
        const ids = new Set((g.productIds || []).map(String));
        const qty = items.reduce((s, i) => (ids.has(String(i.offerId)) ? s + i.qty : s), 0);
        const tiers = [...(g.tiers || [])].sort((a, b) => a.minQty - b.minQty);
        const next = tiers.find((t) => t.minQty > qty) || tiers[tiers.length - 1];
        const done = qty >= next.minQty;
        const tierText =
          next.kind === "fixed_total"
            ? `Llevá ${next.minQty} y pagá $${Number(next.value).toLocaleString("es-AR")}`
            : `${next.minQty}+ con ${Number(next.value).toLocaleString("es-AR")}% off`;
        const members = (g.members || []).filter((m) => ids.has(String(m.id)));
        return (
          <div key={g.id} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-emerald-900">🧊 Armá tu pack: {g.name}</p>
              <span
                className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full whitespace-nowrap ${
                  done ? "bg-emerald-500 text-white" : "bg-white text-emerald-800 border border-emerald-200"
                }`}
              >
                {done ? "¡Pack completo! 🎉" : `Elegidos ${qty}/${next.minQty}`}
              </span>
            </div>
            <p className="text-xs text-emerald-700 mt-0.5">
              {tierText} · tocá los gustos para armar tu pack, el descuento se aplica solo
            </p>
            {!done && qty > 0 && (
              <div className="mt-1.5 h-1.5 rounded-full bg-emerald-900/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, Math.round((qty / next.minQty) * 100))}%` }}
                />
              </div>
            )}
            {members.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {members.map((m) => {
                  // Lo marcado (= en el carrito sin variantes) es lo que combina.
                  const plainQty = items
                    .filter((i) => String(i.offerId) === String(m.id) && !(i.modifiers?.length))
                    .reduce((s, i) => s + i.qty, 0);
                  const marked = plainQty > 0;
                  return (
                  <div
                    key={m.id}
                    className={`rounded-xl bg-white border p-1.5 flex flex-col transition-colors ${
                      marked ? "border-emerald-500 ring-1 ring-emerald-500" : "border-emerald-200"
                    }`}
                  >
                    <div className="h-14 w-full rounded-lg overflow-hidden bg-accent relative">
                      <ProductImage
                        src={m.image || null}
                        name={m.name}
                        alt={m.name}
                        className="w-full h-full object-cover"
                      />
                      {marked && (
                        <span className="absolute top-1 right-1 h-5 w-5 rounded-full bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center">
                          ✓
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-semibold leading-tight mt-1 line-clamp-2 min-h-7">{m.name}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] font-bold tabular-nums">
                        ${Number(m.price).toLocaleString("es-AR")}
                      </span>
                      <div className="flex items-center gap-1">
                        {marked && (
                          <button
                            type="button"
                            aria-label={`Quitar uno de ${m.name}`}
                            onClick={() => setQty(String(m.id), plainQty - 1)}
                            className="h-7 w-7 rounded-full border border-emerald-300 text-emerald-800 text-base font-bold leading-none hover:bg-emerald-100 active:scale-95 transition-transform"
                          >
                            −
                          </button>
                        )}
                        {marked && (
                          <span className="text-[11px] font-bold tabular-nums min-w-4 text-center">{plainQty}</span>
                        )}
                        <button
                          type="button"
                          aria-label={`Agregar ${m.name}`}
                          onClick={() =>
                            addItem(vendor, { offerId: String(m.id), name: m.name, price: Number(m.price), qty: 1 })
                          }
                          className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-base font-bold leading-none hover:bg-primary/90 active:scale-95 transition-transform"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
