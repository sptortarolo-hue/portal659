"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ProductImage } from "@/components/product-image";
import { useCart, type CartModifier } from "@/lib/cart";
import { useToast } from "@/lib/toast";
import type { ProductModifier, ModifierOption } from "@/types/database";

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
 * Mobile: tocás la fila → ficha fullscreen con foto 4:5 (estrategia Instagram:
 * foto completa + relleno blureado), modificadores inline, selector de cantidad
 * y "Agregar al pedido" que cierra la ficha y vuelve al menú.
 * Desktop: fila actual con botón directo (sin modal).
 */
export function GastroProductRow({ product, vendor, modifiers = [], acceptsCart = true, consultHref }: Props) {
  const [open, setOpen] = useState(false);
  const { addItem } = useCart();
  const { addToast } = useToast();

  // Estado inline de la ficha mobile (modificadores + cantidad).
  const [selected, setSelected] = useState<Record<string, ModifierOption[]>>({});
  const [qty, setQty] = useState(1);

  const basePrice = product.promo_price != null ? Number(product.promo_price) : Number(product.price);
  const stockControl = product.stock_control !== false;
  const outStock = stockControl && (product.stock ?? 0) <= 0;

  const modTotal = Object.values(selected)
    .flat()
    .reduce((s, o) => s + Number(o.price_mod || 0), 0);
  const unitTotal = basePrice + modTotal;
  const grandTotal = unitTotal * qty;

  const allRequiredMet = modifiers
    .filter((m) => m.required)
    .every((m) => (selected[m.group_name] || []).length > 0);

  function toggleOption(groupName: string, option: ModifierOption, max: number) {
    setSelected((prev) => {
      const current = prev[groupName] || [];
      const exists = current.find((o) => o.label === option.label);
      let next: ModifierOption[];
      if (exists) {
        next = current.filter((o) => o.label !== option.label);
      } else {
        if (current.length >= max) return prev;
        next = [...current, option];
      }
      return { ...prev, [groupName]: next };
    });
  }

  function openSheet() {
    // Reset del estado al abrir (no arrastrar lo de la vez anterior).
    setSelected({});
    setQty(1);
    setOpen(true);
  }

  function handleAdd() {
    const flat: CartModifier[] = [];
    for (const [group, opts] of Object.entries(selected)) {
      for (const o of opts) flat.push({ group, label: o.label, price_mod: o.price_mod });
    }
    const switched = addItem(vendor, {
      offerId: product.id,
      name: product.name,
      price: basePrice,
      qty,
      modifiers: flat.length > 0 ? flat : undefined,
    });
    addToast(
      switched
        ? "Se limpió el carrito anterior (solo podés pedir de un local a la vez)"
        : `${product.name} agregado al carrito`
    );
    setOpen(false); // cierra la ficha y vuelve al menú
    setQty(1);
  }

  // Desktop: fila compacta con botón directo (comportamiento actual).
  const desktopRow = (
    <div className="hidden sm:flex border border-border rounded-xl p-4 bg-card items-start justify-between gap-4 hover:shadow-md transition-shadow scroll-mt-24">
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
            <AddToCartButton offerId={product.id} name={product.name} price={basePrice} vendor={vendor} modifiers={modifiers} />
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
      onClick={openSheet}
      className="sm:hidden w-full text-left border border-border rounded-xl p-3 bg-card flex items-center gap-3 active:scale-[0.99] transition-transform scroll-mt-16"
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

  // Imagen 45% de la altura vertical con estrategia Instagram: foto completa en
  // object-contain sobre un fondo con la misma imagen blureada en cover.
  const imageBlock = product.image_url ? (
    <div className="h-[45vh] w-full overflow-hidden relative bg-accent">
      <ProductImage
        src={product.image_url}
        name={product.name}
        category={product.category}
        vertical={vendor.vertical}
        alt={product.name}
        className="absolute inset-0 w-full h-full object-cover blur-lg scale-110"
      />
      <ProductImage
        src={product.image_url}
        name={product.name}
        category={product.category}
        vertical={vendor.vertical}
        alt={product.name}
        className="relative w-full h-full object-contain"
      />
    </div>
  ) : (
    <div className="h-[45vh] w-full bg-accent flex items-center justify-center">
      <ProductImage src={null} name={product.name} category={product.category} vertical={vendor.vertical} alt={product.name} className="w-full h-full" iconClassName="h-20 w-20" />
    </div>
  );

  return (
    <div id={`product-${product.id}`} className="scroll-mt-16 sm:scroll-mt-24">
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
            {imageBlock}

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

              {/* Modificadores INLINE (sin overlay) */}
              {!outStock && acceptsCart && modifiers.length > 0 && (
                <div className="border-t border-border pt-3 space-y-4">
                  {modifiers.map((mod) => {
                    const groupSelected = selected[mod.group_name] || [];
                    return (
                      <div key={mod.id}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">{mod.group_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {mod.required ? "Obligatorio" : "Opcional"}
                            {mod.max_selections > 1 && ` · Hasta ${mod.max_selections}`}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {mod.options.map((opt) => {
                            const isChecked = groupSelected.some((o) => o.label === opt.label);
                            return (
                              <button
                                key={opt.label}
                                type="button"
                                onClick={() => toggleOption(mod.group_name, opt, mod.max_selections)}
                                className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                                  isChecked ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`h-4 w-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                                      isChecked ? "border-primary bg-primary" : "border-muted-foreground"
                                    }`}
                                  >
                                    {isChecked && (
                                      <svg className="h-2.5 w-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                                      </svg>
                                    )}
                                  </span>
                                  {opt.label}
                                </span>
                                {Number(opt.price_mod) > 0 && (
                                  <span className="text-muted-foreground">+${Number(opt.price_mod).toLocaleString("es-AR")}</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <footer className="border-t border-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] bg-card space-y-2">
            {!outStock &&
              (acceptsCart ? (
                <>
                  {/* Cantidad */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Cantidad</span>
                    <div className="flex items-center border border-border rounded-lg">
                      <button
                        type="button"
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-l-lg transition-colors"
                        aria-label="Menos"
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-sm font-medium tabular-nums">{qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty((q) => q + 1)}
                        className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-r-lg transition-colors"
                        aria-label="Más"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Total + Agregar */}
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!allRequiredMet}
                    className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-semibold py-3 hover:bg-primary/90 transition-colors active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Agregar al pedido · ${grandTotal.toLocaleString("es-AR")}
                    {modifiers.length > 0 && !allRequiredMet && " (faltan opciones)"}
                  </button>
                </>
              ) : (
                <a href={consultHref} target="_blank" rel="noopener noreferrer" className="block w-full rounded-xl bg-primary text-primary-foreground text-center text-sm font-medium py-3 hover:bg-primary/90 transition-colors">
                  Consultar por WhatsApp
                </a>
              ))}
          </footer>
        </div>
      )}
    </div>
  );
}