import { getSupabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type PageProps = {
  params: { id: string };
};

export default async function ProductDetailPage({ params }: PageProps) {
  const supabase = getSupabase();
  if (!supabase) notFound();

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !product) {
    notFound();
  }

  type ProductRow = {
    id: string;
    vendor_id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    category: string;
    neighborhood: string;
    type: string;
    image_url: string | null;
    stock: number | null;
    available: boolean;
    created_at: string;
  };

const p = product as ProductRow;

  const { data: vendor } = await supabase
    .from("vendors")
    .select("store_name, neighborhood")
    .eq("user_id", p.vendor_id)
    .single();

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center text-6xl">
          {p.type === "food"
            ? "🍽️"
            : p.type === "service"
            ? "🔧"
            : "📦"}
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge>{p.type}</Badge>
            <span className="text-sm text-gray-500">{p.category}</span>
          </div>
          <h1 className="text-3xl font-bold">{p.name}</h1>
          <p className="text-gray-600 text-lg">{p.description}</p>
          <div className="text-3xl font-bold">
            {p.price} {p.currency}
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>📍 {p.neighborhood}</span>
            {vendor && (
              <>
                <span>•</span>
                <span>{(vendor as any).store_name}</span>
              </>
            )}
          </div>
          <div className="flex gap-3 pt-4">
            <Button asChild>
              <Link href={`/quote/${p.id}`}>
                Solicitar presupuesto
              </Link>
            </Button>
            {p.type !== "product" && (
              <Button asChild variant="outline">
                <Link href={`/booking/${p.id}`}>
                  Reservar turno
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}