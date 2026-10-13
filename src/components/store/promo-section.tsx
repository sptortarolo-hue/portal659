"use client";

import { useEffect, useState } from "react";
import { ProductImage } from "@/components/product-image";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { VariantSelector } from "@/components/store/variant-selector";
import { useCart, type CartModifier } from "@/lib/cart";
import { useToast } from "@/lib/toast";
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

function discountInfo(o: PromoItem) {
  const hasOff =
    o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price);
  const pct = hasOff
    ? Math.round((1 - Number(o.promo_price!) / Number(o.price)) * 100)
    : 0;
  const salePrice = hasOff ? Number(o.promo_price!) : Number(o.price);
  return { hasOff, pct, salePrice };
}

/**
 * Sección Promo del micrositio con el look de siempre (tarjeta roja, foto
 * a la izquierda, precios), pero toda clicable: abre la ficha del producto
 * (galería, modificadores/variantes, cantidad, agregar). Sin botón Agregar
 * directo en la lista.
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
  const { addItem } = useCart();
  const { addToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selected = (items || []).find((o) => o.id === selectedId) ?? null;

  function openSheet(o: PromoItem) {
    setSelectedId(o.id);
    setImgIdx(0);
    setQty(1);
    setPickerOpen(false);
  }
  function closeSheet() {
    setSelectedId(null);
    setImgIdx(0);
    setQty(1);
    setPickerOpen(false);
  }

  // El back del celular cierra la ficha en vez de salir de la página.
  useEffect(() => {
    if (!selectedId) return;
    const onPop = () => closeSheet();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pickerOpen) setPickerOpen(false);
      else closeSheet();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    history.pushState({ portal659Sheet: true }, "", window.location.href);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, pickerOpen]);

  function addSimple(o: PromoItem, salePrice: number, hasOff: boolean, n: number) {
    const switched = addItem(vendor, {
      offerId: o.id,
      name: o.name,
      price: salePrice,
      qty: Math.max(1, n),
      cashExcluded: !!o.cash_discount_excluded,
      origPrice: Number(o.price),
      hasPromo: hasOff,
      image: o.image_url ?? null,
    });
    if (switched) addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
    else addToast(`${o.name} agregado al carrito`);
    closeSheet();
  }

  if (!items || items.length === 0) return null;
  return (
    <section className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
      <h3 className="font-display text-xl font-semibold mb-1">🔥 Promo</h3>
      <p className="text-xs text-muted-foreground mb-3">Solo por tiempo limitado · Tocá para ver detalle</p>
      <div className="space-y-3">
        {items.map((o) => {
          const { hasOff, pct, salePrice } = discountInfo(o);
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
                  {hasOff ? (
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
          void salePrice;
          return acceptsCart ? (
            <button
              key={o.id}
              type="button"
              onClick={() => openSheet(o)}
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
        <PromoFicha
          item={selected}
          vendor={vendor}
          modifiers={modifiersByProduct?.[selected.id] || []}
          variants={variantsByProduct?.[selected.id] || []}
          images={imagesByProduct?.[selected.id] || []}
          acceptsCart={acceptsCart}
          consultHref={consultHref}
          imgIdx={imgIdx}
          setImgIdx={setImgIdx}
          qty={qty}
          setQty={setQty}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          onClose={closeSheet}
          onAddSimple={(n) => {
            const { hasOff, salePrice } = discountInfo(selected);
            addSimple(selected, salePrice, hasOff, n);
          }}
          onConfirmMods={(mods, n) => {
            const { hasOff, salePrice } = discountInfo(selected);
            const switched = addItem(vendor, {
              offerId: selected.id,
              name: selected.name,
              price: salePrice,
              qty: Math.max(1, n),
              modifiers: mods.length > 0 ? mods : undefined,
              cashExcluded: !!selected.cash_discount_excluded,
              origPrice: Number(selected.price),
              hasPromo: hasOff,
              image: selected.image_url ?? null,
            });
            if (switched) addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
            else addToast(`${selected.name} agregado al carrito`);
            closeSheet();
          }}
        />
      )}
    </section>
  );
}

function PromoFicha({
  item: o,
  vendor,
  modifiers,
  variants,
  images,
  acceptsCart,
  consultHref,
  imgIdx,
  setImgIdx,
  qty,
  setQty,
  pickerOpen,
  setPickerOpen,
  onClose,
  onAddSimple,
  onConfirmMods,
}: {
  item: PromoItem;
  vendor: CartVendor;
  modifiers: ProductModifier[];
  variants: any[];
  images: any[];
  acceptsCart: boolean;
  consultHref: string;
  imgIdx: number;
  setImgIdx: (i: number) => void;
  qty: number;
  setQty: (n: number) => void;
  pickerOpen: boolean;
  setPickerOpen: (b: boolean) => void;
  onClose: () => void;
  onAddSimple: (qty: number) => void;
  onConfirmMods: (mods: CartModifier[], qty: number) => void;
}) {
  const { hasOff, pct, salePrice } = discountInfo(o);
  const gallery = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of [o.image_url, ...images.map((im) => im?.image_url)]) {
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  })();
  const cover = gallery[Math.min(imgIdx, gallery.length - 1)] ?? null;
  const hasVariants = variants.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div
          className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-2xl bg-card sm:inset-0 sm:m-auto sm:max-w-md sm:h-fit sm:max-h-[90vh] sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-border">
            <p className="font-display font-semibold line-clamp-1 flex-1 min-w-0">{o.name}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-3">
            {cover && (
              <div className="rounded-xl overflow-hidden bg-accent/60">
                <ProductImage
                  src={cover}
                  name={o.name}
                  category={o.category}
                  vertical={vendor.vertical}
                  alt={o.name}
                  className="w-full h-56 object-cover"
                />
              </div>
            )}
            {gallery.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {gallery.map((u, i) => (
                  <button
                    key={`${u}-${i}`}
                    type="button"
                    onClick={() => setImgIdx(i)}
                    className={`h-12 w-12 rounded-lg overflow-hidden flex-shrink-0 border-2 ${i === Math.min(imgIdx, gallery.length - 1) ? "border-primary" : "border-transparent"}`}
                    aria-label={`Foto ${i + 1}`}
                  >
                    <ProductImage
                      src={u}
                      name={o.name}
                      category={o.category}
                      vertical={vendor.vertical}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {o.description && <p className="text-sm text-muted-foreground">{o.description}</p>}

            <div className="flex flex-wrap items-center gap-2">
              {pct > 0 && (
                <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                  −{pct}%
                </span>
              )}
              {hasOff ? (
                <>
                  <span className="text-sm text-muted-foreground line-through tabular-nums">
                    ${Number(o.price).toLocaleString("es-AR")}
                  </span>
                  <span className="font-display text-2xl font-bold text-primary tabular-nums">
                    ${Number(o.promo_price!).toLocaleString("es-AR")}
                  </span>
                </>
              ) : (
                <>
                  <span className="font-display text-2xl font-bold text-primary tabular-nums">
                    ${Number(o.price).toLocaleString("es-AR")}
                  </span>
                  <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                    PROMO
                  </span>
                </>
              )}
            </div>

            {!acceptsCart ? (
              <a
                href={consultHref}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl px-4 py-3 text-sm font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Consultar por WhatsApp
              </a>
            ) : hasVariants ? (
              <VariantSelector
                productId={o.id}
                name={o.name}
                variants={variants}
                vendor={vendor}
                cashExcluded={!!o.cash_discount_excluded}
                image={o.image_url ?? null}
                allowQty
                onAdded={onClose}
              />
            ) : modifiers.length > 0 ? (
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="w-full rounded-xl px-4 py-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Elegir opciones · ${salePrice.toLocaleString("es-AR")}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-xl border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setQty(Math.max(1, qty - 1))}
                    disabled={qty <= 1}
                    className="h-10 w-10 flex items-center justify-center text-base font-semibold hover:bg-muted disabled:opacity-30"
                    aria-label="Menos cantidad"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-sm font-semibold tabular-nums">{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(Math.min(99, qty + 1))}
                    className="h-10 w-10 flex items-center justify-center text-base font-semibold hover:bg-muted"
                    aria-label="Más cantidad"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onAddSimple(qty)}
                  className="flex-1 rounded-xl px-4 py-3 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Agregar · ${(salePrice * qty).toLocaleString("es-AR")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {pickerOpen && (
        <ModifierPicker
          modifiers={modifiers}
          productName={o.name}
          basePrice={salePrice}
          showQty
          onConfirm={(selected, _finalPrice, q) => onConfirmMods(selected, q ?? 1)}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
