import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/product-image";
import { servicePriceLabel } from "@/lib/service-price";
import { cn } from "@/lib/utils";

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
  /** Viene destacada como "oferta del día": anillo solar como los productos. */
  featured?: boolean;
};

/**
 * Card de servicio para el carrusel "La oferta de hoy" del home. Mismo
 * lenguaje visual que OfferCard (anillo sun, foto, precio) pero con ruido de
 * turnera: duración, etiqueta de precio ("Desde $X") y CTA a la reserva.
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
}: ServiceOfferCardProps) {
  const priceLabel = servicePriceLabel({ price, price_from: priceFrom, price_to: priceTo });
  return (
    <Link href={`/tienda/${storeSlug}#reservar-turno`} className="block h-full">
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
              vertical="estetica"
              alt={name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="h-40 bg-gradient-to-br from-accent to-muted flex items-center justify-center">
            <span className="text-4xl">💇</span>
          </div>
        )}
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base line-clamp-1">{name}</CardTitle>
            {featured && (
              <Badge className="bg-sun text-ink hover:bg-sun flex-shrink-0 text-[10px] px-1.5 py-0">Hoy</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {durationMin != null && durationMin > 0 && (
              <Badge variant="secondary" className="text-[10px]">⏱ {durationMin} min</Badge>
            )}
            {priceLabel && (
              <span className="font-display font-bold text-primary text-sm">{priceLabel}</span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
          )}
          <p className="text-xs text-muted-foreground truncate">
            {storeName} · <span className="text-primary font-medium">Reservar turno</span>
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
