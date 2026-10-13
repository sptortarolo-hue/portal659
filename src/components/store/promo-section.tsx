"use client";

import { useState } from "react";
import { GastroProductRow } from "@/components/store/gastro-product-row";
import { ProductCard } from "@/components/store/product-card";
import { ProductImage } from "@/components/product-image";
import type { CartVendor } from "@/lib/cart";
import type { ProductModifier } from "@/types/database";

export type PromoItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  promo_price: number | null;
  image_url?: string | null;
  category?: string | null;
  cash_discount_excluded?: boolean | null;
};

/**
 * Sección Promo del micrositio con el look de siempre (tarjeta roja, foto
 * a la izquierda, precios). Toda la tarjeta abre la ficha REAL del producto
 * (la misma del menú: galería, modificadores/variantes, cantidad, agregar).
 * Sin botón Agregar directo en la lista.
 */
export function PromoSection({
  items,
  vendor,
  modifiersByProduct,
  variantsByProduct,
  imagesByProduct,
  acceptsCart,
  consultHref,
}: {
  items: PromoItem[];
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
  return (
    <section className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
      <h3 className="font-display text-xl font-semibold mb-1">🔥 Promo</h3>
      <p className="text-xs text-muted-foreground mb-3">Solo por tiempo limitado · Tocá para ver detalle</p>
      <div className="space-y-3">
        {items.map((o) => {
          const pct =
            o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price)
              ? Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100)
              : 0;
          const card = (
            <>
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
                  {pct > 0 && (
                    <span className="text-[11px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                      −{pct}%
                    </span>
                  )}
                </div>
                {o.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{o.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {pct > 0 ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through tabular-nums">
                        ${Number(o.price).toLocaleString("es-AR")}
                      </span>
                      <span className="font-bold text-primary tabular-nums">
                        ${Number(o.promo_price!).toLocaleString("es-AR")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-primary tabular-nums">
                        ${Number(o.price).toLocaleString("es-AR")}
                      </span>
                      <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                        PROMO
                      </span>
                    </>
                  )}
                </div>
              </div>
              <span aria-hidden className="text-muted-foreground/60 font-bold text-xl flex-shrink-0 pr-1">›</span>
            </>
          );
          return acceptsCart ? (
            <button
              key={o.id}
              type="button"
              onClick={() => setSelectedId(o.id)}
              className="w-full text-left rounded-2xl border-2 border-red-200 bg-red-50 p-3 flex items-center gap-3 active:scale-[0.99] transition-transform cursor-pointer"
            >
              {card}
            </button>
          ) : (
            <a
              key={o.id}
              href={consultHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl border-2 border-red-200 bg-red-50 p-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
            >
              {card}
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
