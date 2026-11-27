import Link from "next/link";
import { Clock, Scissors, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductImage } from "@/components/product-image";
import { servicePriceLabel } from "@/lib/service-price";

type ServiceOfferCardProps = {
  name: string;
  description: string | null;
  durationMin: number | null;
  price: number | null;
  priceFrom?: number | null;
  priceTo?: number | null;
  storeName: string;
  storeSlug: string;
  imageUrl?: string | null;
  /** Viene destacada como "oferta del día". */
  featured?: boolean;
  /** Vertical del comercio (fallback de ícono). */
  vertical?: string | null;
};

/**
 * Card de servicio para el carrusel "La oferta de hoy" del home. Mismo
 * lenguaje visual que OfferCard, con duración y etiqueta de precio ("Desde $X").
 */
export function ServiceOfferCard({
  name,
  description,
  durationMin,
  price,
  priceFrom,
  priceTo,
  storeName,
  storeSlug,
  imageUrl,
  featured,
  vertical,
}: ServiceOfferCardProps) {
  const priceLabel = servicePriceLabel({ price, price_from: priceFrom, price_to: priceTo });
  const FallbackIcon = vertical === "taller" ? Wrench : Scissors;
  return (
    <Link href={`/tienda/${storeSlug}#reservar-turno`} className="group block h-full">
      <Card className="pv2-card flex h-full flex-col overflow-hidden">
        <div className="relative aspect-[4/3] overflow-hidden">
          {imageUrl ? (
            <ProductImage
              src={imageUrl}
              name={name}
              vertical={vertical === "taller" ? "taller" : "estetica"}
              alt={name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <FallbackIcon className="h-12 w-12 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
            </div>
          )}
        </div>
        <CardHeader className="px-5 pb-1 pt-4">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="pv2-title line-clamp-2 text-lg">{name}</CardTitle>
            {featured && <span className="pv2-chip flex-shrink-0">Hoy</span>}
          </div>
        </CardHeader>
        <CardContent className="flex-1 space-y-2 px-5 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {durationMin != null && durationMin > 0 && (
              <span className="pv2-chip">
                <Clock className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {durationMin} min
              </span>
            )}
            {priceLabel && <span className="pv2-price text-base">{priceLabel}</span>}
          </div>
          {description && (
            <p className="pv2-subtitle line-clamp-2 min-h-[2.5rem] text-sm">{description}</p>
          )}
        </CardContent>
        <div className="mt-auto px-5 pb-5">
          <p className="truncate text-xs text-muted-foreground">
            {storeName} · Reservar turno
          </p>
        </div>
      </Card>
    </Link>
  );
}
