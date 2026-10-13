"use client";

import { useState } from "react";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ProductImage } from "@/components/product-image";

type GiftProduct = {
  id: string;
  name: string;
  price: number;
  image_url?: string | null;
};

/**
 * Tarjeta de regalo (comercio/moda): UNA sola tarjeta visual para toda la
 * sección — selector de monto (pills) que agrega al carrito el producto
 * real de ese valor. Si el comercio no tiene carrito, ofrece pedir por
 * WhatsApp.
 * Visual por comercio: foto del producto elegido → logo del local →
 * ilustración genérica (CSS puro, sin archivos externos).
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
  // Foto del monto elegido → logo del local → ilustración genérica.
  const photo = selected?.image_url || null;
  const logo = !photo ? vendor.logoUrl || null : null;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm max-w-sm">
      {photo ? (
        <div className="relative h-40 w-full">
          <ProductImage
            key={photo}
            src={photo}
            name={selected?.name || "Tarjeta de regalo"}
            vertical={vendor.vertical}
            alt="Tarjeta de regalo"
            className="h-40 w-full"
          />
          <span className="absolute top-2 right-2 rounded-full bg-white/80 text-rose-700 text-[10px] font-semibold px-2 py-0.5">
            Regalo
          </span>
        </div>
      ) : logo ? (
        <div className="relative h-40 w-full bg-gradient-to-br from-rose-100 via-pink-100 to-amber-100 dark:from-rose-950/40 dark:via-pink-950/40 dark:to-amber-950/40 flex items-center justify-center">
          <div className="h-24 w-24 rounded-full overflow-hidden bg-white shadow-sm">
            <ProductImage
              key={logo}
              src={logo}
              name={vendor.storeName}
              vertical={vendor.vertical}
              alt={vendor.storeName}
              className="h-24 w-24"
            />
          </div>
          <span className="absolute top-2 right-2 rounded-full bg-white/80 text-rose-700 text-[10px] font-semibold px-2 py-0.5">
            Regalo
          </span>
        </div>
      ) : (
      <div className="relative h-40 w-full bg-gradient-to-br from-rose-100 via-pink-100 to-amber-100 dark:from-rose-950/40 dark:via-pink-950/40 dark:to-amber-950/40 flex items-center justify-center">
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(255,255,255,0.9) 0 10px, transparent 12px), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.7) 0 8px, transparent 10px)" }} />
        <div className="relative text-6xl drop-shadow-sm">🎁</div>
        <span className="absolute top-2 right-2 rounded-full bg-white/80 text-rose-700 text-[10px] font-semibold px-2 py-0.5">
          Regalo
        </span>
      </div>
      )}
      <div className="p-4 space-y-3">
        <div>
          <p className="font-display font-semibold">Tarjeta de regalo</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Regalá saldo para usar en {vendor.storeName}. Se consume con un código.
          </p>
        </div>
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
