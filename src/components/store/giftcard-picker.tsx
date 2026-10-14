"use client";

import { useState } from "react";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { TarjetaRegalo } from "@/components/store/tarjeta-regalo";

type GiftProduct = {
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
};

/**
 * Tarjeta de regalo (comercio/moda): UNA sola tarjeta visual para toda la
 * sección — el diseño especial (TarjetaRegalo, sin código porque aún no
 * existe hasta cobrar) + selector de monto (pills) que agrega al carrito el
 * producto real de ese valor. Si el comercio no tiene carrito, ofrece pedir
 * por WhatsApp.
 */
export function GiftCardPicker({
  cards,
  vendor,
  acceptsCart = true,
  waUrl,
}: {
  cards: GiftProduct[];
  vendor: {
    id: string;
    slug: string;
    storeName: string;
    logoUrl?: string | null;
    whatsapp: string;
    vertical?: string | null;
    cashDiscountPct?: number | null;
    deliveryFee?: number | null;
    freeDeliveryMin?: number | null;
  };
  acceptsCart?: boolean;
  waUrl?: string;
}) {
  const sorted = [...cards].sort((a, b) => a.price - b.price);
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null);
  const selected = sorted.find((c) => c.id === selectedId) ?? null;
  if (sorted.length === 0) return null;

  return (
    <div className="max-w-sm space-y-3">
      <TarjetaRegalo
        compact
        storeName={vendor.storeName}
        logoUrl={vendor.logoUrl}
        amount={selected?.price ?? 0}
        photoUrl={selected?.image_url ?? null}
        vertical={vendor.vertical}
      />
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3 shadow-sm">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Elegí el monto</p>
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/50"
                  }`}
                >
                  ${c.price.toLocaleString("es-AR")}
                </button>
              );
            })}
          </div>
        </div>
        {!acceptsCart ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-lg bg-primary text-primary-foreground text-center text-sm font-medium py-2.5 hover:bg-primary/90"
          >
            Pedir por WhatsApp
          </a>
        ) : selected ? (
          <AddToCartButton offerId={selected.id} name={selected.name} price={selected.price} vendor={vendor} modifiers={[]} image={selected.image_url ?? null} />
        ) : null}
        <p className="text-[10px] text-muted-foreground text-center">
          El local te pasa el código por WhatsApp al cobrar.
        </p>
      </div>
    </div>
  );
}
