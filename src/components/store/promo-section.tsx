"use client";

import { GastroProductRow } from "@/components/store/gastro-product-row";
import { ProductCard } from "@/components/store/product-card";
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
 * Sección Promo del micrositio: cada producto abre su ficha al tocar
 * (mobile: ficha fullscreen; desktop: fila con Agregar directo, salvo moda
 * que abre ficha como su vidriera). Sin botón Agregar directo en la lista.
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
  if (!items || items.length === 0) return null;
  const isModa = vendor.vertical === "moda";
  return (
    <section className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
      <h3 className="font-display text-xl font-semibold mb-1">🔥 Promo</h3>
      <p className="text-xs text-muted-foreground mb-3">Solo por tiempo limitado · Tocá para ver detalle</p>
      {isModa ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((o) => {
            const pct =
              o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price)
                ? Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100)
                : 0;
            return (
              <div
                key={o.id}
                className="rounded-2xl border-2 border-red-200 bg-white p-2 shadow-sm"
              >
                <div className="flex items-center gap-1.5 px-1 pb-1.5">
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                    {pct > 0 ? `−${pct}%` : "PROMO"}
                  </span>
                </div>
                <ProductCard
                  product={o}
                  variants={variantsByProduct?.[o.id] || []}
                  images={imagesByProduct?.[o.id] || []}
                  vendor={vendor}
                  modifiers={modifiersByProduct?.[o.id] || []}
                  acceptsCart={acceptsCart}
                  consultHref={consultHref}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((o) => {
            const pct =
              o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price)
                ? Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100)
                : 0;
            return (
              <div
                key={o.id}
                className="rounded-2xl border-2 border-red-200 bg-white p-2 shadow-sm"
              >
                <div className="flex items-center gap-1.5 px-1 pb-1.5">
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                    {pct > 0 ? `−${pct}%` : "PROMO"}
                  </span>
                </div>
                <GastroProductRow
                  product={o}
                  vendor={vendor}
                  modifiers={modifiersByProduct?.[o.id] || []}
                  acceptsCart={acceptsCart}
                  consultHref={consultHref}
                  images={imagesByProduct?.[o.id] || []}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
