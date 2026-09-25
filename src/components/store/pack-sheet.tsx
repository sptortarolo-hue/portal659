"use client";

import { useEffect, useMemo, useState } from "react";
import { useCart, type CartVendor, type CartVolumeGroup } from "@/lib/cart";
import { mirrorVolume } from "@/lib/volume-mirror";
import { volumeGroupColor } from "@/lib/volume-pricing";
import { ProductImage } from "@/components/product-image";

export type PackMember = {
  id: string;
  name: string;
  image?: string | null;
  price: number;
};

export type PackGroup = {
  id: string;
  name: string;
  productIds: string[];
  memberNames?: string[];
  members?: PackMember[];
  tiers: { minQty: number; kind: "fixed_total" | "percent_off"; value: number }[];
};

function openPack(groupId: string) {
  window.dispatchEvent(new CustomEvent("portal659:open-pack", { detail: { groupId } }));
}

/**
 * Sheet "Completá tu pack": se abre al agregar un combinable con el pack
 * incompleto (modo armado) o al completarlo (modo festejo). El descuento lo
 * aplica el servidor; acá solo se arma la combinación.
 */
export function PackSheet({
  group,
  vendor,
  mode,
  onClose,
}: {
  group: PackGroup;
  vendor: CartVendor;
  mode: "armado" | "festejo";
  onClose: () => void;
}) {
  const { items, addItem, setQty, setOpen } = useCart();
  const c = volumeGroupColor(group.id);
  const ids = new Set((group.productIds || []).map(String));
  const qty = items.reduce((s, i) => (ids.has(String(i.offerId)) ? s + i.qty : s), 0);
  const tiers = [...(group.tiers || [])].sort((a, b) => a.minQty - b.minQty);
  const next = tiers.find((t) => t.minQty > qty) || tiers[tiers.length - 1];
  // Solo (1 miembro): precio por cantidad, sin hablar de combinar.
  const isSolo = (group.productIds || []).length <= 1;
  const tierText = isSolo
    ? next.kind === "fixed_total"
      ? `Llevá ${next.minQty} y pagá $${Number(next.value).toLocaleString("es-AR")} · solo, no combina con otros`
      : `${next.minQty}+ con ${Number(next.value).toLocaleString("es-AR")}% off · solo, no combina con otros`
    : next.kind === "fixed_total"
      ? `pack x${next.minQty}, combinables entre sí · pagás $${Number(next.value).toLocaleString("es-AR")}`
      : `pack x${next.minQty}+, combinables entre sí · ${Number(next.value).toLocaleString("es-AR")}% off`;
  const members = (group.members || []).filter((m) => ids.has(String(m.id)));
  // Ahorro vivo del pack (espejo; el servidor recalcula y manda).
  const vol = useMemo(
    () =>
      mirrorVolume(items, [
        {
          id: group.id,
          name: group.name,
          productIds: group.productIds,
          combinePromo: false,
          combineCash: false,
          extrasIncluded: false,
          tiers: group.tiers,
        } as CartVolumeGroup,
      ]),
    [items, group]
  );
  const missing = Math.max(0, next.minQty - qty);

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 animate-fade-in-up" onClick={onClose}>
      <div
        className="absolute bottom-0 left-0 right-0 sm:left-1/2 sm:right-auto sm:bottom-auto sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-md bg-card rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-4 pt-3 pb-2 rounded-t-2xl sm:rounded-t-2xl ${c.soft} border-b ${c.border}`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm font-bold ${c.strong}`}>
              {mode === "festejo"
                ? `🧊 ¡Pack completo! 🎉: ${group.name}`
                : isSolo
                  ? `🧊 ${group.name}`
                  : `🧊 Completá tu pack: ${group.name}`}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="h-8 w-8 rounded-full hover:bg-black/5 flex items-center justify-center text-muted-foreground flex-shrink-0"
            >
              ✕
            </button>
          </div>
          <p className={`text-xs mt-0.5 ${c.text}`}>{tierText}</p>
          {mode === "armado" ? (
            <p className={`text-xs font-semibold tabular-nums mt-1 ${c.strong}`}>
              Elegidos {qty}/{next.minQty}
            </p>
          ) : (
            <p className={`text-xs font-semibold mt-1 ${c.strong}`}>
              El descuento ya está aplicado en tu carrito
            </p>
          )}
          {mode === "armado" && (
            <div className="mt-1.5 h-1.5 rounded-full bg-black/10 overflow-hidden">
              <div
                className={`h-full rounded-full ${c.bar} transition-all`}
                style={{ width: `${Math.min(100, Math.round((qty / next.minQty) * 100))}%` }}
              />
            </div>
          )}
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-2">
          {members.length > 0 ? (
            members.map((m) => {
              const plainQty = items
                .filter((i) => String(i.offerId) === String(m.id) && !(i.modifiers?.length))
                .reduce((s, i) => s + i.qty, 0);
              const marked = plainQty > 0;
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 rounded-xl border p-2 bg-card transition-colors ${
                    marked ? `${c.border} ring-1 ${c.ring}` : c.border
                  }`}
                >
                  <div className="h-12 w-12 rounded-lg overflow-hidden bg-accent flex-shrink-0 relative">
                    <ProductImage
                      src={m.image || null}
                      name={m.name}
                      alt={m.name}
                      className="w-full h-full object-cover"
                    />
                    {marked && (
                      <span className={`absolute top-0.5 right-0.5 h-4 w-4 rounded-full ${c.solid} text-white text-[10px] font-bold flex items-center justify-center`}>
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight truncate">{m.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      ${Number(m.price).toLocaleString("es-AR")}
                      {marked ? ` · en tu pack: ${plainQty}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {marked && (
                      <button
                        type="button"
                        aria-label={`Quitar uno de ${m.name}`}
                        onClick={() => setQty(String(m.id), plainQty - 1)}
                        className="h-8 w-8 rounded-full border border-border text-base font-bold leading-none hover:bg-muted active:scale-95 transition-transform"
                      >
                        −
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Agregar ${m.name}`}
                      onClick={() =>
                        addItem(vendor, { offerId: String(m.id), name: m.name, price: Number(m.price), qty: 1 })
                      }
                      className="h-8 w-8 rounded-full bg-primary text-primary-foreground text-base font-bold leading-none hover:bg-primary/90 active:scale-95 transition-transform"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              {isSolo
                ? "Precio por cantidad para este producto."
                : `Se combinan entre sí: ${(group.memberNames || []).filter(Boolean).join(" · ")}`}
            </p>
          )}
        </div>

        <div className="border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] bg-card rounded-b-2xl">
          {mode === "festejo" ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                setOpen(true);
              }}
              className="block w-full rounded-xl bg-primary text-primary-foreground text-center text-sm font-medium py-3 hover:bg-primary/90 transition-colors"
            >
              Ver carrito
            </button>
          ) : (
            <>
              {vol.volumeDiscount > 0 && (
                <p className={`text-xs font-semibold text-center mb-2 ${c.strong}`}>
                  Te ahorrás ${Number(vol.volumeDiscount).toLocaleString("es-AR")} con este pack
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                className="block w-full rounded-xl bg-muted text-foreground text-center text-sm font-medium py-3 hover:bg-muted/80 transition-colors"
              >
                {missing > 0 ? `Te faltan ${missing} · Seguir armando` : "Seguir armando"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Host montado en el micrositio: escucha `portal659:open-pack` ({groupId}) y
 * abre el sheet en modo armado o festejo según el carrito actual.
 */
export function PackSheetHost({ groups, vendor }: { groups: PackGroup[]; vendor: CartVendor }) {
  const { items } = useCart();
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ groupId?: string }>).detail?.groupId;
      if (id) setOpenId(String(id));
    };
    window.addEventListener("portal659:open-pack", onOpen);
    return () => window.removeEventListener("portal659:open-pack", onOpen);
  }, []);

  const group = (groups || []).find((g) => String(g.id) === String(openId)) || null;
  if (!group) return null;

  const ids = new Set((group.productIds || []).map(String));
  const qty = items.reduce((s, i) => (ids.has(String(i.offerId)) ? s + i.qty : s), 0);
  const tiers = [...(group.tiers || [])].sort((a, b) => a.minQty - b.minQty);
  const top = tiers[tiers.length - 1];
  const mode = top && qty >= top.minQty ? "festejo" : "armado";

  return <PackSheet group={group} vendor={vendor} mode={mode} onClose={() => setOpenId(null)} />;
}

export { openPack };
