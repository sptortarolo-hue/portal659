"use client";

import { useState, useMemo } from "react";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { VariantSelector } from "./variant-selector";

type VendorBrief = {
  id: string;
  slug: string;
  storeName: string;
  whatsapp: string;
  vertical?: string | null;
};

type Props = {
  product: any;
  variants?: any[];
  images?: any[];
  vendor: VendorBrief;
  modifiers?: any[];
};

function variantSummary(vars: any[]) {
  const prices = vars.map((x) => (x.promo != null ? Number(x.promo) : Number(x.price)));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const baseMin = Math.min(...vars.map((x) => Number(x.price)));
  const discounts = vars
    .filter((x) => x.promo != null && Number(x.price) > 0)
    .map((x) => Math.round((1 - Number(x.promo) / Number(x.price)) * 100));
  const best = discounts.length > 0 ? Math.max(...discounts) : null;
  return { min, max, baseMin, best };
}

export function ProductCard({ product, variants = [], images = [], vendor, modifiers }: Props) {
  const [open, setOpen] = useState(false);
  const [activeImg, setActiveImg] = useState(0);

  const hasVariants = variants.length > 0;
  const imgs = images.length > 0 ? images : product.image_url ? [{ image_url: product.image_url }] : [];
  const cover = imgs[activeImg]?.image_url || imgs[0]?.image_url || null;

  const summary = hasVariants ? variantSummary(variants) : null;

  const totalStock = hasVariants
    ? variants.reduce((a, v) => a + (v.stock ?? 0), 0)
    : (product.stock ?? 0);
  const outStock = totalStock <= 0;
  const lowStock = !outStock && totalStock <= (hasVariants ? 5 : (product.stock_low_threshold ?? 5));

  const bestDiscount = hasVariants
    ? variantBestDiscount(variants)
    : product.promo_price && Number(product.price) > 0
      ? Math.round((1 - Number(product.promo_price) / Number(product.price)) * 100)
      : null;

  const priceLabel = hasVariants && summary
    ? summary.min === summary.max
      ? `$${summary.min.toLocaleString("es-AR")}`
      : `Desde $${summary.min.toLocaleString("es-AR")}`
    : `$${(product.promo_price ?? product.price).toLocaleString("es-AR")}`;

  const regularLabel = hasVariants && summary
    ? summary.baseMin !== summary.min
      ? `De $${summary.baseMin.toLocaleString("es-AR")}`
      : null
    : product.promo_price
      ? `De $${Number(product.price).toLocaleString("es-AR")}`
      : null;

  return (
    <>
      <div className="flex flex-col rounded-xl overflow-hidden border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative w-full aspect-square overflow-hidden bg-accent/60 block"
        >
          {cover ? (
            <img src={cover} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="font-display text-6xl font-bold text-primary/25">{product.name.charAt(0)}</span>
            </div>
          )}

          {bestDiscount != null && (
            <span className="absolute top-2 left-2 rounded-full bg-red-500 text-white text-xs font-bold px-2 py-0.5">
              -{bestDiscount}%
            </span>
          )}
          {product.featured_today && (
            <span className="absolute top-2 right-2 rounded-full bg-sun text-ink text-xs font-bold px-2 py-0.5">Hoy</span>
          )}

          <div className="absolute inset-x-0 bottom-0 px-3 py-2 flex items-center justify-between gap-2 bg-gradient-to-t from-black/50 to-transparent">
            {outStock ? (
              <span className="text-xs font-semibold text-white">Sin stock</span>
            ) : lowStock ? (
              <span className="text-xs font-semibold text-amber-300">¡Últimas unidades!</span>
            ) : (
              <span className="text-xs text-white/90">{imgs.length > 0 ? `${imgs.length} foto${imgs.length > 1 ? "s" : ""}` : "Ver"}</span>
            )}
            <span className="text-sm text-white hover:underline">Ver →</span>
          </div>
        </button>

        <div className="p-2.5 flex flex-col gap-0.5 flex-1">
          <p className="font-medium text-[13px] leading-snug line-clamp-1">{product.name}</p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className={`font-display font-bold text-sm ${bestDiscount != null ? "text-primary" : ""}`}>{priceLabel}</span>
            {regularLabel && <span className="text-[10px] text-muted-foreground line-through">{regularLabel}</span>}
          </div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setOpen(false); setActiveImg(0); }} />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl bg-card sm:inset-0 sm:m-auto sm:max-w-md sm:h-fit sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-card border-b border-border">
              <p className="font-display font-semibold line-clamp-1">{product.name}</p>
              <button
                type="button"
                onClick={() => { setOpen(false); setActiveImg(0); }}
                className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-foreground hover:bg-accent"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded-xl overflow-hidden bg-accent aspect-[4/5] max-h-80">
                {cover ? (
                  <img src={cover} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="font-display text-6xl font-bold text-primary/25">{product.name.charAt(0)}</span>
                  </div>
                )}
              </div>

              {imgs.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {imgs.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActiveImg(i)}
                      className={`h-16 w-16 flex-shrink-0 rounded-lg overflow-hidden border-2 ${activeImg === i ? "border-primary" : "border-transparent"}`}
                    >
                      <img src={img.image_url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <h2 className="font-display text-xl font-semibold">{product.name}</h2>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-bold text-lg">{priceLabel}</span>
                  {regularLabel && <span className="text-sm text-muted-foreground line-through">{regularLabel}</span>}
                  {bestDiscount != null && (
                    <span className="rounded-full bg-red-500 text-white text-[11px] font-bold px-2 py-0.5">-{bestDiscount}%</span>
                  )}
                </div>
              </div>

              {product.description && (
                <p className="text-sm text-muted-foreground">{product.description}</p>
              )}

              <div className="border-t border-border pt-4">
                {outStock ? (
                  <p className="text-sm font-medium text-red-600 text-center py-3">Sin stock por el momento</p>
                ) : hasVariants ? (
                  <VariantSelector productId={product.id} name={product.name} variants={variants} vendor={vendor} />
                ) : (
                  <AddToCartButton
                    offerId={product.id}
                    name={product.name}
                    price={product.promo_price ? Number(product.promo_price) : Number(product.price)}
                    vendor={vendor}
                    modifiers={modifiers}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function variantBestDiscount(vars: any[]) {
  const discounts = vars
    .filter((x) => x.promo != null && Number(x.price) > 0)
    .map((x) => Math.round((1 - Number(x.promo) / Number(x.price)) * 100));
  return discounts.length > 0 ? Math.max(...discounts) : null;
}