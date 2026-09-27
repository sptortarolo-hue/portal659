import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
    <Link href={href} className="block h-full">
      <Card
        className={cn(
          "h-full hover:shadow-xl transition-all duration-200 hover:-translate-y-1 cursor-pointer overflow-hidden",
          featured && "ring-2 ring-sun"
        )}
      >
        {imageUrl ? (
          <div className="h-40 bg-muted overflow-hidden">
            <ProductImage
              src={imageUrl}
              name={name}
              category={category}
              vertical={vertical}
              alt={name}
              className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
            />
          </div>
        ) : (
          <div className="h-40 flex items-center justify-center">
            <ProductImage
              src={null}
              name={name}
              category={category}
              vertical={vertical}
              alt={name}
              className="w-full h-full"
              iconClassName="h-12 w-12"
            />
          </div>
        )}
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            {featured && (
              <Badge className="bg-sun text-ink hover:bg-sun">
                Hoy
              </Badge>
            )}
            {pct != null && (
              <span className="rounded-full bg-red-500 text-white text-[10px] font-bold px-2 py-0.5">
                -{pct}%
              </span>
            )}
            {category && (
              <span className="text-xs text-muted-foreground capitalize">
                {category}
              </span>
            )}
          </div>
          <CardTitle className="font-display text-lg">{name}</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <p className="text-sm text-muted-foreground line-clamp-2">
            {description}
          </p>
        </CardContent>
        <div className="px-6 pb-4 flex items-center justify-between gap-2">
          {promo != null ? (
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-xs text-muted-foreground line-through tabular-nums">
                ${Number(price).toLocaleString("es-AR")}
              </span>
              <span className="font-bold text-lg text-primary tabular-nums">
                ${promo.toLocaleString("es-AR")}
              </span>
            </span>
          ) : (
            <span className="font-bold text-lg text-foreground">
              ${Number(price).toLocaleString("es-AR")}
            </span>
          )}
          <span className="text-xs text-muted-foreground flex-shrink-0">{storeName}</span>
        </div>
      </Card>
    </Link>
  );
}
