import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ProductCardProps = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  neighborhood: string;
  type: "product" | "service" | "food";
  image_url: string | null;
  vendor_name: string;
};

const typeColors = {
  product: "bg-blue-100 text-blue-800",
  service: "bg-green-100 text-green-800",
  food: "bg-orange-100 text-orange-800",
};

export function ProductCard({
  id,
  name,
  description,
  price,
  currency,
  category,
  neighborhood,
  type,
  image_url,
  vendor_name,
}: ProductCardProps) {
  return (
    <Link href={`/products/${id}`}>
      <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
        {image_url ? (
          <div className="aspect-video bg-gray-100">
            <img
              src={image_url}
              alt={name}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="aspect-video bg-gray-100 flex items-center justify-center text-4xl">
            {type === "food" ? "🍽️" : type === "service" ? "🔧" : "📦"}
          </div>
        )}
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Badge className={cn(typeColors[type])}>{type}</Badge>
            <span className="text-xs text-gray-500">{category}</span>
          </div>
          <CardTitle className="text-base">{name}</CardTitle>
        </CardHeader>
        <CardContent className="pb-2">
          <p className="text-sm text-gray-600 line-clamp-2">{description}</p>
        </CardContent>
        <CardFooter className="flex justify-between items-center pt-0">
          <span className="font-bold text-lg">
            {price} {currency}
          </span>
          <span className="text-xs text-gray-500">{vendor_name}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}