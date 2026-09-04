"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ProductImage } from "@/components/product-image";
import type { ProductModifier } from "@/types/database";

type VendorBrief = {
  id: string;
  slug: string;
  storeName: string;
  whatsapp: string;
  vertical?: string | null;
  deliveryFee?: number | null;
  freeDeliveryMin?: number | null;
};

type Props = {
  product: {
    id: string;
    name: string;
    price: number;
    promo_price: number | null;
    description?: string | null;
    image_url?: string | null;
    category?: string | null;
    featured_today?: boolean;
    stock?: number | null;
    stock_low_threshold?: number | null;
    stock_control?: boolean;
  };
  vendor: VendorBrief;
  modifiers?: ProductModifier[];
  acceptsCart?: boolean;
  consultHref?: string;
};

/**
 * Fila de producto del menú gastro.
 * Mobile: tocás la fila → ficha fullscreen (foto grande, descripción,
 * modificadores, agregar/consultar, botón volver). Desktop: fila actual con
 * botón directo (sin modal), como se venía usando.
 */
export function GastroProductRow({ product, vendor, modifiers = [], acceptsCart = true, consultHref }: Props) {
  const [open, setOpen] = useState(false);

  const price = product.promo_price != null ? Number(product.promo_price) : Number(product.price);
  const stockControl = product.stock_control !== false;
  const outStock = stockControl && (product.stock ?? 0) <= 0;

  // Desktop: fila compacta con botón directo (comportamiento actual).
  const desktopRow = (
    <div className="hidden sm:flex border border-border rounded-xl p-4 bg-card items-start justify-between gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 min-w-0">
        {product.image_url ? (
          <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
            <ProductImage src={product.image_url} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="h-20 w-20 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
            <ProductImage src={null} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full" iconClassName="h-8 w-8" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-semibold leading-tight">{product.name}</p>
            {product.featured_today && <Badge className="bg-sun text-ink hover:bg-sun">Hoy</Badge>}
            {outStock && <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px]">Sin stock</Badge>}
          </div>
          {product.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        {product.promo_price ? (
          <div className="text-right">
            <span className="font-bold text-primary">${Number(product.promo_price).toLocaleString("es-AR")}</span>
            <span className="block text-xs text-muted-foreground line-through">${Number(product.price).toLocaleString("es-AR")}</span>
          </div>
        ) : (
          <span className="font-bold">${Number(product.price).toLocaleString("es-AR")}</span>
        )}
        {!outStock &&
          (acceptsCart ? (
            <AddToCartButton offerId={product.id} name={product.name} price={price} vendor={vendor} modifiers={modifiers} />
          ) : (
            <a href={consultHref} target="_blank" rel="noopener noreferrer" className="rounded-md px-3 py-1.5 text-sm font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90">Consultar</a>
          ))}
      </div>
    </div>
  );

  // Mobile: fila tappable → ficha fullscreen.
  const mobileRow = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="sm:hidden w-full text-left border border-border rounded-xl p-3 bg-card flex items-center gap-3 active:scale-[0.99] transition-transform"
    >
      {product.image_url ? (
        <div className="h-16 w-16 rounded-xl overflow-hidden flex-shrink-0">
          <ProductImage src={product.image_url} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="h-16 w-16 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden bg-accent">
          <ProductImage src={null} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full" iconClassName="h-6 w-6" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="font-semibold leading-tight truncate">{product.name}</p>
          {product.featured_today && <Badge className="bg-sun text-ink text-[10px] px-1.5">Hoy</Badge>}
        </div>
        {product.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.description}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {product.promo_price ? (
            <>
              <span className="font-bold text-primary">${Number(product.promo_price).toLocaleString("es-AR")}</span>
              <span className="text-xs text-muted-foreground line-through">${Number(product.price).toLocaleString("es-AR")}</span>
            </>
          ) : (
            <span className="font-bold">${Number(product.price).toLocaleString("es-AR")}</span>
          )}
          {outStock && <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px]">Sin stock</Badge>}
        </div>
      </div>
      <span className="text-muted-foreground text-lg flex-shrink-0">›</span>
    </button>
  );

  return (
    <>
      {desktopRow}
      {mobileRow}

      {/* Ficha fullscreen mobile */}
      {open && (
        <div className="sm:hidden fixed inset-0 z-[60] bg-background flex flex-col">
          <header className="flex items-center gap-2 border-b border-border px-3 py-3">
            <button
              onClick={() => setOpen(false)}
              className="shrink-0 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
              aria-label="Volver al menú"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="font-display font-semibold leading-tight truncate">{product.name}</h3>
          </header>

          <div className="flex-1 overflow-y-auto">
            <div className="aspect-[4/3] w-full bg-accent">
              {product.image_url ? (
                <ProductImage src={product.image_url} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full object-cover" />
              ) : (
                <ProductImage src={null} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full" iconClassName="h-20 w-20" />
              )}
            </div>

            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  {product.promo_price ? (
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-2xl font-bold text-primary">${Number(product.promo_price).toLocaleString("es-AR")}</span>
                      <span className="text-sm text-muted-foreground line-through">${Number(product.price).toLocaleString("es-AR")}</span>
                    </div>
                  ) : (
                    <span className="font-display text-2xl font-bold">${Number(product.price).toLocaleString("es-AR")}</span>
                  )}
                </div>
                {product.featured_today && <Badge className="bg-sun text-ink">Hoy</Badge>}
              </div>

              {product.description && (
                <p className="text-sm text-muted-foreground">{product.description}</p>
              )}

              {outStock && (
                <p className="text-sm font-medium text-red-600 text-center py-2">Sin stock por el momento</p>
              )}
            </div>
          </div>

          <footer className="border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] bg-card">
            {!outStock &&
              (acceptsCart ? (
                <AddToCartButton offerId={product.id} name={product.name} price={price} vendor={vendor} modifiers={modifiers} />
              ) : (
                <a href={consultHref} target="_blank" rel="noopener noreferrer" className="block w-full rounded-xl bg-primary text-primary-foreground text-center text-sm font-medium py-3 hover:bg-primary/90 transition-colors">
                  Consultar por WhatsApp
                </a>
              ))}
          </footer>
        </div>
      )}
    </>
  );
}