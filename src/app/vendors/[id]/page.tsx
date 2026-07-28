import { getSupabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ProductCard } from "@/components/products/product-card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type PageProps = {
  params: { id: string };
};

export default async function VendorPage({ params }: PageProps) {
  const supabase = getSupabase();
  if (!supabase) notFound();

  const { data: vendor, error: vendorError } = await supabase
    .from("vendors")
    .select("*")
    .eq("id", params.id)
    .single();

  if (vendorError || !vendor) {
    notFound();
  }

  const v = vendor as any;

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", params.id)
    .eq("available", true);

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="bg-white rounded-lg border p-6 mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold">{v.store_name}</h1>
            <p className="text-gray-600 mt-1">{v.category}</p>
            {v.neighborhood && (
              <p className="text-sm text-gray-500 mt-1">
                📍 {v.neighborhood}
              </p>
            )}
          </div>
          {v.accepting_quotes && (
            <Badge variant="secondary">Acepta presupuestos</Badge>
          )}
        </div>
        {v.hours && (
          <p className="text-sm text-gray-500 mt-3">
            🕐 {v.hours}
          </p>
        )}
        {v.whatsapp && (
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <a
                href={`https://wa.me/${v.whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
            </Button>
          </div>
        )}
      </div>

      <h2 className="text-xl font-bold mb-4">Productos y servicios</h2>
      {products && products.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p: any) => (
            <ProductCard
              key={p.id}
              id={p.id}
              name={p.name}
              description={p.description}
              price={p.price}
              currency={p.currency}
              category={p.category}
              neighborhood={p.neighborhood}
              type={p.type}
              image_url={p.image_url}
              vendor_name={v.store_name}
            />
          ))}
        </div>
      ) : (
        <p className="text-gray-500">Aún no tiene productos publicados.</p>
      )}
    </main>
  );
}