"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MessageCircle, ShoppingBag, Star } from "lucide-react";
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
    <Link
      href={href ?? `/tienda/${slug}`}
      className="pv2-card group flex min-w-[260px] max-w-[300px] snap-start flex-col overflow-hidden"
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
        {image_url ? (
          <ProductImage
            src={image_url}
            name={store_name}
            vertical={vertical}
            alt={store_name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <ProductImage
            src={null}
            name={store_name}
            vertical={vertical}
            alt={store_name}
            className="h-full w-full"
            iconClassName="h-12 w-12"
          />
        )}
        {logo_url && (
          <ProductImage
            src={logo_url}
            name={store_name}
            vertical={vertical}
            alt={`Logo de ${store_name}`}
            className="pv2-card-logo absolute bottom-3 left-3 h-12 w-12"
          />
        )}
        {isOpen !== null && (
          <span className={`pv2-badge absolute right-3 top-3 ${isOpen ? "pv2-badge-open" : "pv2-badge-closed"}`}>
            {openStatusText(isOpen)}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="pv2-title truncate text-base">{store_name}</h3>
        {description && (
          <p className="pv2-subtitle mt-2 line-clamp-2 min-h-[2.5rem] text-xs">
            {description}
          </p>
        )}
        {avgRating !== null && (
          <div className="mt-3 flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="text-xs font-semibold">{avgRating.toFixed(1)}</span>
            <span className="text-[10px] text-muted-foreground">({reviewCount})</span>
          </div>
        )}
        <div className="mt-auto pt-4">
          {acceptsCart !== null && acceptsCart !== undefined && (
            <span className={`pv2-chip ${acceptsCart ? "" : "pv2-chip-muted"}`}>
              {acceptsCart ? (
                <ShoppingBag className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              ) : (
                <MessageCircle className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              )}
              {acceptsCart ? "Pedí online" : "Solo contacto"}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
