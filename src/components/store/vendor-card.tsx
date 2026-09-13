"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { isStoreOpen, openStatusText } from "@/lib/open-hours";
import { ProductImage } from "@/components/product-image";

type VendorCardProps = {
  id: string;
  slug: string | null;
  store_name: string;
  image_url?: string | null;
  logo_url?: string | null;
  description?: string | null;
  vertical?: string | null;
  hours?: string | null;
  open_override?: boolean | null;
  /** Vende por la app (carrito). null/undefined = no mostrar badge (compat). */
  acceptsCart?: boolean | null;
  /** Destino del link (default: micrositio público). Útil en modo prueba. */
  href?: string | null;
};

export function VendorCard({ id, slug, store_name, image_url, logo_url, description, vertical, hours, open_override, acceptsCart, href }: VendorCardProps) {
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    fetch(`/api/reviews?vendor_id=${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.count > 0) {
          setAvgRating(data.avgRating);
          setReviewCount(data.count);
        }
      })
      .catch(() => {});
  }, [id]);

  const isOpen = isStoreOpen({ hours, open_override });

  if (!slug) return null;

  return (
    <Link href={href ?? `/tienda/${slug}`} className="min-w-[260px] max-w-[300px] snap-start block group">
      <div className="relative rounded-2xl border border-border bg-card overflow-hidden hover:shadow-xl transition-all duration-200 hover:-translate-y-1">
        {image_url ? (
          <div className="h-36 overflow-hidden">
            <ProductImage
              src={image_url}
              name={store_name}
              vertical={vertical}
              alt={store_name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>
        ) : (
          <div className="h-36 flex items-center justify-center">
            <ProductImage
              src={null}
              name={store_name}
              vertical={vertical}
              alt={store_name}
              className="w-full h-full"
              iconClassName="h-12 w-12"
            />
          </div>
        )}
        {logo_url && (
          <ProductImage
            src={logo_url}
            name={store_name}
            vertical={vertical}
            alt={`Logo de ${store_name}`}
            className="absolute left-3 top-3 h-12 w-12 rounded-full border-2 border-white shadow-md"
          />
        )}
        {isOpen !== null && (
          <span
            className={`absolute top-3 right-3 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
              isOpen
                ? "bg-green-500 text-white"
                : "bg-red-500 text-white"
            }`}
          >
            {openStatusText(isOpen)}
          </span>
        )}
        <div className="p-4">
          <h3 className="font-display text-base font-semibold truncate">{store_name}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{description}</p>
          )}
          {avgRating !== null && (
            <div className="flex items-center gap-1 mt-2">
              <span className="text-amber-400 text-sm">★</span>
              <span className="text-xs font-medium">{avgRating.toFixed(1)}</span>
              <span className="text-[10px] text-muted-foreground">({reviewCount})</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-2 gap-2">
            <p className="text-xs text-primary font-medium">
              {acceptsCart === false || vertical === "servicio" ? "Ver y contactar →" : "Ver y pedir →"}
            </p>
            {acceptsCart !== null && acceptsCart !== undefined && (
              <span
                className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full tabular-nums ${
                  acceptsCart ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {acceptsCart ? "🛒 Pedí online" : "💬 Solo contacto"}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
