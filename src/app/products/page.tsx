import { getSupabase } from "@/lib/supabase";
import { ProductCard } from "@/components/products/product-card";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

type SearchParams = {
  barrio?: string;
  q?: string;
  type?: string;
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <main className="container mx-auto px-4 py-8">
        <p className="text-red-600">Error: no se pudo conectar a la base de datos</p>
      </main>
    );
  }

  const { barrio, q, type: typeFilter } = await searchParams;

  let query = supabase
    .from("products")
    .select("*")
    .eq("available", true)
    .order("created_at", { ascending: false });

  if (barrio) {
    query = query.eq("neighborhood", barrio);
  }
  if (typeFilter && typeFilter !== "all") {
    query = query.eq("type", typeFilter);
  }
  if (q) {
    query = query.or(
      `name.ilike.%${q}%,description.ilike.%${q}%`
    );
  }

  const { data: products, error } = await query;

  const barrioLabel = barrio
    ? barrio.charAt(0).toUpperCase() + barrio.slice(1)
    : "Todos los barrios";

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Productos y servicios</h1>
      <p className="text-gray-600 mb-6">
        Mostrando para{" "}
        <span className="font-medium">{barrioLabel}</span>
      </p>

      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <Input
          placeholder="Buscar productos o servicios..."
          defaultValue={q || ""}
          className="max-w-sm"
        />
        <select
          defaultValue={typeFilter || "all"}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="all">Todas las categorías</option>
          <option value="product">Productos</option>
          <option value="service">Servicios</option>
          <option value="food">Comida</option>
        </select>
      </div>

      {error ? (
        <p className="text-red-600">Error al cargar productos</p>
      ) : !products || products.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          No se encontraron resultados en esta zona.
        </p>
      ) : (
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
              vendor_name={p.vendor_name || ""}
            />
          ))}
        </div>
      )}
    </main>
  );
}