"use client";

import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ProductImage } from "@/components/product-image";
import type { CartVendor } from "@/lib/cart";
import type { ProductModifier } from "@/types/database";

export type PromoItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  promo_price: number;
  image_url?: string | null;
  category?: string | null;
  cash_discount_excluded?: boolean | null;
};

/**
 * Sección Promo: look distinto al listado (estilo promos de delivery).
 * Solo productos con precio promo válido. El precio promo fluye al carrito
 * y checkout con la lógica existente (hasPromo).
 */
export function PromoSection({
  items,
  vendor,
  modifiersByProduct,
  acceptsCart,
  consultHref,
}: {
  items: PromoItem[];
  vendor: CartVendor;
  modifiersByProduct?: Record<string, ProductModifier[]>;
  acceptsCart: boolean;
  consultHref: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
      <h3 className="font-display text-xl font-semibold mb-1">🔥 Promo</h3>
      <p className="text-xs text-muted-foreground mb-3">Solo por tiempo limitado</p>
      <div className="space-y-3">
        {items.map((o) => {
          const pct = Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100);
          const mods = modifiersByProduct?.[o.id] || [];
          return (
            <div
              key={o.id}
              className="rounded-2xl border-2 border-red-200 bg-red-50 p-3 flex items-center gap-3"
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
                  {pct > 0 && (
                    <span className="text-[11px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                      −{pct}%
                    </span>
                  )}
                </div>
                {o.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{o.description}</p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground line-through tabular-nums">
                    ${Number(o.price).toLocaleString("es-AR")}
                  </span>
                  <span className="font-bold text-primary tabular-nums">
                    ${Number(o.promo_price).toLocaleString("es-AR")}
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0">
                {acceptsCart ? (
                  <AddToCartButton
                    offerId={o.id}
                    name={o.name}
                    price={Number(o.promo_price)}
                    vendor={vendor}
                    modifiers={mods}
                    cashExcluded={!!o.cash_discount_excluded}
                    origPrice={Number(o.price)}
                    hasPromo
                  />
                ) : (
                  <a
                    href={consultHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md px-3 py-1.5 text-sm font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Consultar
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
