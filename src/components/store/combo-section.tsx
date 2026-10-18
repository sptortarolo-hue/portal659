"use client";

import { useState } from "react";
import { GastroProductRow } from "@/components/store/gastro-product-row";
import { ProductCard } from "@/components/store/product-card";
import { ProductImage } from "@/components/product-image";
import type { CartVendor } from "@/lib/cart";
import type { ProductModifier } from "@/types/database";

export type ComboItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  promo_price: number | null;
  image_url?: string | null;
  category?: string | null;
};

/**
 * Sección Combos del micrositio: armarlo en el panel, se venden acá como
 * un producto más (precio combo fijado por el local). La tarjeta muestra el
 * desglose "Incluye" de combo_items; al tocar abre la ficha real del combo
 * (la misma del menú: galería, modificadores, cantidad, agregar).
 */
export function ComboSection({
  items,
  membersByCombo,
  vendor,
  modifiersByProduct,
  variantsByProduct,
  imagesByProduct,
  acceptsCart,
  consultHref,
}: {
  items: ComboItem[];
  /** combo_id → líneas cargadas de combo_items (para el desglose). */
  membersByCombo: Record<string, { product_id: string; qty: number; name: string; price: number }[]>;
  vendor: CartVendor;
  modifiersByProduct?: Record<string, ProductModifier[]>;
  variantsByProduct?: Record<string, any[]>;
  imagesByProduct?: Record<string, any[]>;
  acceptsCart: boolean;
  consultHref: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (items || []).find((o) => o.id === selectedId) ?? null;
  const isModa = vendor.vertical === "moda";

  if (!items || items.length === 0) return null;
  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR")}`;
  return (
    <section className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
      <h3 className="font-display text-xl font-semibold mb-1">🧩 Combos</h3>
      <p className="text-xs text-muted-foreground mb-3">Armados por el local · Tocá para ver qué trae</p>
      <div className="space-y-3">
        {items.map((o) => {
          const pct =
            o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price)
              ? Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100)
              : 0;
          const members = membersByCombo?.[o.id] || [];
          const incluye =
            members.length > 0
              ? members.map((m) => (m.qty > 1 ? `${m.qty}× ${m.name}` : m.name)).join(" + ")
              : null;
          const incluyeSum = members.reduce((a, m) => a + (Number(m.price) || 0) * (m.qty || 1), 0);
          return acceptsCart ? (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelectedId(o.id)}
              className="w-full text-left rounded-2xl border-2 border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/50 p-3 flex items-center gap-3 active:scale-[0.99] transition-transform cursor-pointer"
            >
              <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-white">
                <ProductImage
                  src={o.image_url || null}
                  name={o.name}
                  category={o.category}
                  vertical={vendor.vertical}
                  alt={o.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="font-bold leading-snug line-clamp-2 flex-1">{o.name}</p>
                  <span className="text-[11px] font-bold text-white bg-violet-500 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                    🧩 COMBO
                  </span>
                </div>
                {incluye && (
                  <p className="text-xs text-violet-900 dark:text-violet-300 mt-0.5 line-clamp-2 break-words">
                    <span className="font-semibold">Incluye:</span> {incluye}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {pct > 0 ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through tabular-nums">{fmt(o.price)}</span>
                      <span className="font-bold text-primary tabular-nums">{fmt(o.promo_price!)}</span>
                      {incluyeSum > 0 && Number(o.promo_price) < incluyeSum && (
                        <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Ahorrás {fmt(incluyeSum - Number(o.promo_price))}</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-primary tabular-nums">{fmt(o.price)}</span>
                      {incluyeSum > 0 && Number(o.price) < incluyeSum && (
                        <>
                          <span className="text-xs text-muted-foreground line-through tabular-nums">{fmt(incluyeSum)}</span>
                          <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Ahorrás {fmt(incluyeSum - Number(o.price))}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              <span aria-hidden className="text-muted-foreground/60 font-bold text-xl flex-shrink-0 pr-1">›</span>
            </button>
          ) : (
            <a
              key={o.id}
              href={consultHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border-2 border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/50 p-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
            >
              <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0 bg-white">
                <ProductImage
                  src={o.image_url || null}
                  name={o.name}
                  category={o.category}
                  vertical={vendor.vertical}
                  alt={o.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold leading-snug line-clamp-2">{o.name}</p>
                <p className="text-xs text-violet-900 dark:text-violet-300 mt-0.5">
                  <span className="text-[11px] font-bold text-white bg-violet-500 rounded-full px-2 py-0.5 mr-1">🧩 COMBO</span>
                  {incluye ? <><span className="font-semibold">Incluye:</span> {incluye} · </> : null}
                  <span className="font-bold tabular-nums">{fmt(o.price)}</span>
                </p>
              </div>
            </a>
          );
        })}
      </div>

      {selected && (
        <div key={selected.id} className="h-0 overflow-hidden">
          {isModa ? (
            <ProductCard
              product={selected}
              variants={variantsByProduct?.[selected.id] || []}
              images={imagesByProduct?.[selected.id] || []}
              vendor={vendor}
              modifiers={modifiersByProduct?.[selected.id] || []}
              acceptsCart={acceptsCart}
              consultHref={consultHref}
              autoOpen
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <GastroProductRow
              product={selected}
              vendor={vendor}
              modifiers={modifiersByProduct?.[selected.id] || []}
              acceptsCart={acceptsCart}
              consultHref={consultHref}
              images={imagesByProduct?.[selected.id] || []}
              autoOpen
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}
