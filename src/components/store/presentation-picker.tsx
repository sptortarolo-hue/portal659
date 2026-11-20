"use client";

import { useState, useMemo } from "react";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ProductImage } from "@/components/product-image";

type Presentation = {
  id: string;
  name: string;
  price: number;
  promo_price?: number | null;
  stock?: number | null;
  presentation_label?: string | null;
  presentation_qty?: number | null;
  presentation_unit?: string | null;
  image_url?: string | null;
  available?: boolean;
  cash_discount_excluded?: boolean;
};

type Props = {
  root: any;
  presentations: Presentation[];
  vendor: any;
  acceptsCart: boolean;
  consultHref?: string;
};

function priceOf(p: Presentation) {
  return p.promo_price != null ? Number(p.promo_price) : Number(p.price);
}

function pricePerKg(p: Presentation) {
  const q = Number(p.presentation_qty) || 1;
  if (q <= 0) return null;
  return priceOf(p) / q;
}

const ars = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

export function PresentationPicker({ root, presentations, vendor, acceptsCart, consultHref }: Props) {
  const sorted = useMemo(
    () => [...presentations].sort((a, b) => (Number(a.presentation_qty) || 0) - (Number(b.presentation_qty) || 0)),
    [presentations]
  );
  const [activeId, setActiveId] = useState<string>(sorted[0]?.id || root.id);
  const active = sorted.find((p) => p.id === activeId) || sorted[0] || root;

  const perKgValues = sorted.map((p) => pricePerKg(p)).filter((v): v is number => v != null);
  const bestPerKg = perKgValues.length > 0 ? Math.min(...perKgValues) : null;

  const activePrice = priceOf(active);
  const activePerKg = pricePerKg(active);
  const isBest = bestPerKg != null && activePerKg != null && Math.abs(activePerKg - bestPerKg) < 0.01;

  return (
    <div className="space-y-2">
      {/* Chips de presentación */}
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((p) => {
          const pk = pricePerKg(p);
          const isBestChip = bestPerKg != null && pk != null && Math.abs(pk - bestPerKg) < 0.01;
          const isActive = p.id === active.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveId(p.id)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50"
              }`}
            >
              {p.presentation_label || p.name}
              {isBestChip && <span className="ml-1 text-[9px] text-emerald-600">★</span>}
            </button>
          );
        })}
      </div>

      {/* Precio + $/kg del activo */}
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold tabular-nums">{ars(activePrice)}</span>
        {activePerKg != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {ars(activePerKg)}/kg
            {isBest && <span className="ml-1 text-emerald-600 font-medium">· Mejor precio por kg</span>}
          </span>
        )}
        {active.stock != null && active.stock <= 5 && active.stock > 0 && (
          <span className="text-xs text-amber-600">Quedan {active.stock}</span>
        )}
        {active.stock === 0 && (
          <span className="text-xs text-red-500">Sin stock</span>
        )}
      </div>

      {/* Agregar al carrito */}
      {acceptsCart && active.available !== false && active.stock !== 0 && (
        <AddToCartButton
          offerId={active.id}
          name={`${root.name} ${active.presentation_label || ""}`.trim()}
          price={activePrice}
          vendor={vendor}
          image={active.image_url || root.image_url || null}
          cashExcluded={active.cash_discount_excluded === true}
        />
      )}
      {!acceptsCart && consultHref && (
        <a href={consultHref} className="text-sm text-primary underline">Consultar por WhatsApp</a>
      )}
    </div>
  );
}