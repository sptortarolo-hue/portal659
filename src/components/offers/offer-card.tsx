import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ProductImage } from "@/components/product-image";

type OfferCardProps = {
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  storeName: string;
  storeSlug: string;
  featured?: boolean;
  imageUrl?: string | null;
  vertical?: string | null;
};

export function OfferCard({
  name,
  description,
  price,
  category,
  storeName,
  storeSlug,
  featured,
  imageUrl,
  vertical,
}: OfferCardProps) {
  return (
    <Link href={`/tienda/${storeSlug}`} className="block h-full">
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
        <div className="px-6 pb-4 flex items-center justify-between">
          <span className="font-bold text-lg text-foreground">
            ${Number(price).toLocaleString("es-AR")}
          </span>
          <span className="text-xs text-muted-foreground">{storeName}</span>
        </div>
      </Card>
    </Link>
  );
}
