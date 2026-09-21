"use client";

import { useState, useMemo, useEffect } from "react";
import { useCart } from "@/lib/cart";
import type { CartModifier } from "@/lib/cart";
import { useToast } from "@/lib/toast";
import { CashPrice } from "@/components/store/cash-price";
import { cashAppliesToItem, normalizeCashPct } from "@/lib/cash-discount";
import { parseGuideLine } from "@/lib/size-guides";
import type { ProductVariant } from "@/types/database";

type Props = {
  productId: string;
  name: string;
  variants: ProductVariant[];
  vendor: {
    id: string;
    slug: string;
    storeName: string;
    whatsapp: string;
    vertical?: string | null;
    deliveryFee?: number | null;
    freeDeliveryMin?: number | null;
    cashDiscountPct?: number | null;
  };
  stockControl?: boolean;
  /** La promo del producto está excluida del descuento en efectivo. */
  cashExcluded?: boolean;
  /** Foto miniatura para el carrito (moda). Opcional, no rompe gastro. */
  image?: string | null;
  /** Guía de talles (texto, "Talle: medidas" por línea). Muestra link + modal si viene. */
  sizeGuide?: string | null;
  /** Stepper de cantidad (moda). Gastro con variantes sigue agregando de a 1. */
  allowQty?: boolean;
  /** Al cambiar de color (la ficha cambia la foto principal a la de ese color). */
  onColorChange?: (color: string) => void;
};

export function VariantSelector({ productId, name, variants, vendor, stockControl = true, cashExcluded = false, image, sizeGuide, allowQty = false, onColorChange }: Props) {
  const { addItem } = useCart();
  const { addToast } = useToast();
  const [color, setColor] = useState<string | null>(null);
  const [talle, setTalle] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  const slowStock = stockControl && variants.some((v) => (v.stock ?? 0) > 0 && (v.stock ?? 0) <= 5);

  const colors = useMemo(() => Array.from(new Set(variants.map((v) => v.color).filter(Boolean))).sort(), [variants]);
  const talles = useMemo(() => Array.from(new Set(variants.map((v) => v.talle).filter(Boolean))).sort(), [variants]);

  const withColor = color ? variants.filter((v) => v.color === color) : variants;
  const availableTalles = Array.from(new Set(withColor.map((v) => v.talle).filter(Boolean))).sort();

  const current = variants.find((v) => v.color === color && v.talle === talle) || null;
  const outOfStock = stockControl && current != null && (current.stock ?? 0) <= 0;

  const price = current ? (current.promo != null ? current.promo : current.price) : null;
  const promo = current?.promo != null ? -Math.round((1 - current.promo / current.price) * 100) : null;
  const showCash =
    current != null && price != null &&
    normalizeCashPct(vendor.cashDiscountPct) > 0 &&
    cashAppliesToItem({ hasPromo: current.promo != null, excluded: cashExcluded });

  const totalStock = stockControl ? variants.reduce((acc, v) => acc + (v.stock ?? 0), 0) : 1;

  // Cantidad máxima: stock de la combinación elegida (sin control = sin tope).
  const maxQty = stockControl && current ? Math.max(1, current.stock ?? 0) : 99;

  // Al cambiar color/talle, la cantidad vuelve a 1 (puede no haber stock del anterior).
  useEffect(() => { setQty(1); }, [color, talle]);

  function handleAdd() {
    if (!current || outOfStock) return;
    const n = allowQty ? Math.min(qty, maxQty) : 1;
    const mods: CartModifier[] = [];
    if (current.color) mods.push({ group: "Color", label: current.color, price_mod: 0 });
    if (current.talle) mods.push({ group: "Talle", label: current.talle, price_mod: 0 });
    // price_mod 0: el precio ya está definido en el producto según variante.
    const switched = addItem(
      { id: vendor.id, slug: vendor.slug, storeName: vendor.storeName, whatsapp: vendor.whatsapp, vertical: vendor.vertical, deliveryFee: vendor.deliveryFee ?? null, freeDeliveryMin: vendor.freeDeliveryMin ?? null, cashDiscountPct: vendor.cashDiscountPct ?? null },
      { offerId: productId, variantId: current.id, name, price: price!, qty: n, modifiers: mods, cashExcluded: current.promo != null && cashExcluded, image: image ?? null }
    );
    addToast(n > 1 ? `${name} (${current.color} / ${current.talle}) × ${n} agregado al carrito` : `${name} (${current.color} / ${current.talle}) agregado al carrito`);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    if (switched) addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
  }

  const guideLines = sizeGuide
    ? sizeGuide.split("\n").map((l) => l.trim()).filter(Boolean).map(parseGuideLine)
    : [];

  return (
    <div className="space-y-3">
      {colors.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Color</p>
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => {
              const cStock = variants.filter((v) => v.color === c).reduce((a, v) => a + (v.stock ?? 0), 0);
              const cOut = stockControl && cStock <= 0;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={cOut}
                  onClick={() => { setColor(c); setTalle(null); onColorChange?.(c); }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
                    color === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : cOut
                        ? "border-border bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
                        : "border-border bg-card text-foreground hover:border-primary"
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {talles.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5 gap-2">
            <p className="text-xs font-medium text-muted-foreground">Talle</p>
            {guideLines.length > 0 && (
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
              >
                📏 Guía de talles
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(color ? availableTalles : talles).map((t) => {
              const scope = color ? variants.filter((v) => v.color === color && v.talle === t) : variants.filter((v) => v.talle === t);
              const tStock = scope.reduce((a, v) => a + (v.stock ?? 0), 0);
              const tOut = stockControl && tStock <= 0;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={tOut}
                  onClick={() => setTalle(t)}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold border transition ${
                    talle === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : tOut
                        ? "border-border bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
                        : "border-border bg-card text-foreground hover:border-primary"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {current && (
        <div className="flex items-center justify-between border-t pt-3">
          <div>
            {promo != null && (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-red-500 text-white text-[10px] font-bold px-2 py-0.5">
                  -{promo}%
                </span>
                <span className="ml-2 text-sm text-muted-foreground line-through">${current.price.toLocaleString("es-AR")}</span>
              </>
            )}
            <div className="font-display text-lg font-bold">
              {showCash ? (
                <CashPrice price={price!} hasPromo={current.promo != null} excluded={cashExcluded} cashPct={vendor.cashDiscountPct} size="md" plainClassName="font-display text-lg font-bold" />
              ) : (
                <>${price!.toLocaleString("es-AR")}</>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {outOfStock ? (
              <span className="text-red-600 font-semibold">Sin stock</span>
            ) : (
              <span>{current.stock} disponibles</span>
            )}
          </div>
        </div>
      )}

      {totalStock > 0 && !current && (
        <p className="text-xs text-muted-foreground">Elegí una combinación para ver precio y stock.</p>
      )}

      {allowQty && current && !outOfStock && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-muted-foreground">Cantidad</span>
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              disabled={qty <= 1}
              className="h-8 w-8 flex items-center justify-center text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Menos cantidad"
            >
              −
            </button>
            <span className="w-9 text-center text-sm font-semibold tabular-nums">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              disabled={qty >= maxQty}
              className="h-8 w-8 flex items-center justify-center text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-30"
              aria-label="Más cantidad"
            >
              +
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={!current || outOfStock}
        onClick={handleAdd}
        className={`w-full rounded-lg px-4 py-2 text-sm font-medium transition-all ${
          added
            ? "bg-green-500 text-white animate-pop-in"
            : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        }`}
      >
        {added ? "✓ Agregado" : outOfStock || totalStock <= 0 ? "Sin stock" : allowQty && qty > 1 ? `Agregar ${qty} al carrito` : "Agregar al carrito"}
      </button>
      {slowStock && <p className="text-xs text-amber-700 font-medium">¡Quedan pocas unidades!</p>}

      {guideOpen && guideLines.length > 0 && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60" onClick={() => setGuideOpen(false)} />
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-card sm:inset-0 sm:m-auto sm:max-w-sm sm:h-fit sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-border">
              <p className="font-display font-semibold">Guía de talles</p>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center text-foreground hover:bg-accent"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <table className="w-full text-sm">
                <tbody>
                  {guideLines.map((g, i) =>
                    g ? (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3 font-semibold whitespace-nowrap">{g.talle}</td>
                        <td className="py-2 text-muted-foreground">{g.rest}</td>
                      </tr>
                    ) : null
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}