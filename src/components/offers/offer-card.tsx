import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type OfferCardProps = {
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  storeName: string;
  storeSlug: string;
  featured?: boolean;
  imageUrl?: string | null;
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
}: OfferCardProps) {
  return (
    <Link href={`/tienda/${storeSlug}`} className="block h-full">
      <Card
        className={cn(
          "h-full hover:shadow-lg transition-shadow cursor-pointer overflow-hidden",
          featured && "ring-2 ring-sun"
        )}
      >
        {imageUrl ? (
          <div className="aspect-video bg-muted">
            <img
              src={imageUrl}
              alt={name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
            <span className="font-display text-5xl font-bold text-primary/60">
              {name.charAt(0)}
            </span>
          </div>
        )}
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            {featured && (
              <Badge className="bg-sun text-pine hover:bg-sun">
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
