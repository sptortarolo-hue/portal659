"use client";

import { useState, useMemo } from "react";
import { useCart } from "@/lib/cart";
import type { CartModifier } from "@/lib/cart";
import { useToast } from "@/lib/toast";
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
  };
};

export function VariantSelector({ productId, name, variants, vendor }: Props) {
  const { addItem } = useCart();
  const { addToast } = useToast();
  const [color, setColor] = useState<string | null>(null);
  const [talle, setTalle] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const slowStock = variants.some((v) => (v.stock ?? 0) > 0 && (v.stock ?? 0) <= 5);

  const colors = useMemo(() => Array.from(new Set(variants.map((v) => v.color).filter(Boolean))).sort(), [variants]);
  const talles = useMemo(() => Array.from(new Set(variants.map((v) => v.talle).filter(Boolean))).sort(), [variants]);

  const withColor = color ? variants.filter((v) => v.color === color) : variants;
  const availableTalles = Array.from(new Set(withColor.map((v) => v.talle).filter(Boolean))).sort();

  const current = variants.find((v) => v.color === color && v.talle === talle) || null;
  const outOfStock = current != null && (current.stock ?? 0) <= 0;

  const price = current ? (current.promo != null ? current.promo : current.price) : null;
  const promo = current?.promo != null ? -Math.round((1 - current.promo / current.price) * 100) : null;

  const totalStock = variants.reduce((acc, v) => acc + (v.stock ?? 0), 0);

  function handleAdd() {
    if (!current || outOfStock) return;
    const mods: CartModifier[] = [];
    if (current.color) mods.push({ group: "Color", label: current.color, price_mod: 0 });
    if (current.talle) mods.push({ group: "Talle", label: current.talle, price_mod: 0 });
    // price_mod 0: el precio ya está definido en el producto según variante.
    const switched = addItem(
      { id: vendor.id, slug: vendor.slug, storeName: vendor.storeName, whatsapp: vendor.whatsapp, vertical: vendor.vertical },
      { offerId: productId, name, price: price!, qty: 1, modifiers: mods }
    );
    addToast(`${name} (${current.color} / ${current.talle}) agregado al carrito`);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
    if (switched) addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
  }

  return (
    <div className="space-y-3">
      {colors.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Color</p>
          <div className="flex flex-wrap gap-1.5">
            {colors.map((c) => {
              const cStock = variants.filter((v) => v.color === c).reduce((a, v) => a + (v.stock ?? 0), 0);
              const cOut = cStock <= 0;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={cOut}
                  onClick={() => { setColor(c); setTalle(null); }}
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
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Talle</p>
          <div className="flex flex-wrap gap-1.5">
            {(color ? availableTalles : talles).map((t) => {
              const scope = color ? variants.filter((v) => v.color === color && v.talle === t) : variants.filter((v) => v.talle === t);
              const tStock = scope.reduce((a, v) => a + (v.stock ?? 0), 0);
              const tOut = tStock <= 0;
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
              ${price!.toLocaleString("es-AR")}
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
        {added ? "✓ Agregado" : outOfStock || totalStock <= 0 ? "Sin stock" : "Agregar al carrito"}
      </button>
      {slowStock && <p className="text-xs text-amber-700 font-medium">¡Quedan pocas unidades!</p>}
    </div>
  );
}