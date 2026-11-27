"use client";

import { useState, useMemo } from "react";
import { Star } from "lucide-react";
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
              className={`pv2-pill px-2.5 py-1 text-xs ${isActive ? "pv2-active" : ""}`}
            >
              {p.presentation_label || p.name}
              {isBestChip && <Star className="ml-1 inline h-3 w-3 pv2-icon-accent" fill="currentColor" />}
            </button>
          );
        })}
      </div>

      {/* Precio + $/kg del activo */}
      <div className="flex items-baseline gap-2">
        <span className="pv2-price">{ars(activePrice)}</span>
        {activePerKg != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {ars(activePerKg)}/kg
            {isBest && <span className="ml-1 font-medium pv2-icon-accent">· Mejor precio por kg</span>}
          </span>
        )}
        {active.stock != null && active.stock <= 5 && active.stock > 0 && (
          <span className="pv2-chip">Quedan {active.stock}</span>
        )}
        {active.stock === 0 && (
          <span className="pv2-chip pv2-chip-muted">Sin stock</span>
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