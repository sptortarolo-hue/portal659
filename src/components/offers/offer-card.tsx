import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductImage } from "@/components/product-image";

type OfferCardProps = {
  name: string;
  description: string | null;
  price: number;
  /** Precio promo (si hay oferta válida se muestra tachado + descuento). */
  promoPrice?: number | null;
  category: string | null;
  storeName: string;
  storeSlug: string;
  offerId?: string;
  featured?: boolean;
  imageUrl?: string | null;
  vertical?: string | null;
};

export function OfferCard({
  name,
  description,
  price,
  promoPrice,
  category,
  storeName,
  storeSlug,
  offerId,
  featured,
  imageUrl,
  vertical,
}: OfferCardProps) {
  // Misma regla de promo válida que el micrositio: menor que el normal y > 0.
  const promo =
    promoPrice != null && Number(promoPrice) > 0 && Number(promoPrice) < Number(price)
      ? Number(promoPrice)
      : null;
  const pct = promo != null && Number(price) > 0
    ? Math.round((1 - promo / Number(price)) * 100)
    : null;
  const href = offerId
    ? `/tienda/${storeSlug}?menu=1&oferta=${encodeURIComponent(offerId)}`
    : `/tienda/${storeSlug}?menu=1`;
  return (
    <Link href={href} className="group block h-full">
      <Card className="pv2-card flex h-full flex-col overflow-hidden">
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {imageUrl ? (
            <ProductImage
              src={imageUrl}
              name={name}
              category={category}
              vertical={vertical}
              alt={name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <ProductImage
              src={null}
              name={name}
              category={category}
              vertical={vertical}
              alt={name}
              className="h-full w-full"
              iconClassName="h-12 w-12"
            />
          )}
          {pct != null && <span className="pv2-discount">-{pct}%</span>}
        </div>
        <CardHeader className="px-5 pb-1 pt-4">
          <div className="flex items-center gap-2">
            {featured && <span className="pv2-chip">Hoy</span>}
            {category && (
              <span className="text-xs text-muted-foreground capitalize">
                {category}
              </span>
            )}
          </div>
          <CardTitle className="pv2-title mt-2 line-clamp-2 text-lg">{name}</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 px-5 pb-3">
          <p className="pv2-subtitle line-clamp-2 min-h-[2.5rem] text-sm">
            {description}
          </p>
        </CardContent>
        <div className="mt-auto px-5 pb-5">
          <div className="flex items-baseline gap-2">
            {promo != null && (
              <span className="pv2-price-old">
                ${Number(price).toLocaleString("es-AR")}
              </span>
            )}
            <span className="pv2-price">
              ${(promo ?? Number(price)).toLocaleString("es-AR")}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{storeName}</p>
        </div>
      </Card>
    </Link>
  );
}
