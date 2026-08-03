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
          featured && "ring-2 ring-primary"
        )}
      >
        {imageUrl ? (
          <div className="aspect-video bg-gray-100">
            <img
              src={imageUrl}
              alt={name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-video bg-gradient-to-br from-amber-50 to-orange-100 flex items-center justify-center">
            <span className="text-4xl font-bold text-orange-300">
              {name.charAt(0)}
            </span>
          </div>
        )}
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            {featured && <Badge>Hoy</Badge>}
            {category && (
              <span className="text-xs text-gray-500 capitalize">{category}</span>
            )}
          </div>
          <CardTitle className="text-base">{name}</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <p className="text-sm text-gray-600 line-clamp-2">{description}</p>
        </CardContent>
        <div className="px-6 pb-4 flex items-center justify-between">
          <span className="font-bold text-lg">
            ${Number(price).toLocaleString("es-AR")}
          </span>
          <span className="text-xs text-gray-500">{storeName}</span>
        </div>
      </Card>
    </Link>
  );
}
