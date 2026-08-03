import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { PRIMARY_NEIGHBORHOOD, NEIGHBORHOODS } from "@/lib/config";
import { OfferCard } from "@/components/offers/offer-card";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      <main className="container mx-auto px-4 py-8 text-center">
        <p className="text-red-600">
          Error de configuración. Verificá las variables de entorno.
        </p>
      </main>
    );
  }

  const { data: vendors } = await supabase
    .from("vendors")
    .select("*")
    .eq("neighborhood", PRIMARY_NEIGHBORHOOD.slug)
    .order("created_at", { ascending: false });

  const { data: offers } = await supabase
    .from("products")
    .select("*, vendors(id, slug, store_name)")
    .eq("neighborhood", PRIMARY_NEIGHBORHOOD.slug)
    .eq("available", true)
    .order("featured_today", { ascending: false })
    .order("created_at", { ascending: false });

  const featured =
    offers?.filter((o: any) => o.featured_today) || [];
  const rest = offers?.filter((o: any) => !o.featured_today) || [];

  return (
    <main className="container mx-auto px-4 py-8">
      <section className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          conectaMOS
        </h1>
        <p className="mt-3 text-lg text-gray-600 max-w-2xl mx-auto">
          La galería gastronómica de tu barrio. Pedí comida casera y regional
          directo a los productores de {PRIMARY_NEIGHBORHOOD.name}, sin
          comisiones ni intermediarios.
        </p>
      </section>

      <section className="flex flex-wrap justify-center gap-2 mb-10">
        {NEIGHBORHOODS.map((n) => (
          <span
            key={n.slug}
            className={`rounded-full px-4 py-1.5 text-sm ${
              n.active
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            {n.name}
            {!n.active && " (próximamente)"}
          </span>
        ))}
      </section>

      {featured.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-2xl font-bold">La oferta de hoy</h2>
            <span className="rounded-full bg-orange-100 text-orange-700 px-3 py-1 text-xs font-medium">
              Elegida por los locales de {PRIMARY_NEIGHBORHOOD.name}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map((o: any) => (
              <OfferCard
                key={o.id}
                name={o.name}
                description={o.description}
                price={Number(o.price)}
                category={o.category}
                storeName={o.vendors?.store_name || ""}
                storeSlug={o.vendors?.slug || ""}
                featured
                imageUrl={o.image_url}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mb-12">
        <h2 className="text-2xl font-bold mb-4">
          Los locales de {PRIMARY_NEIGHBORHOOD.name}
        </h2>
        {!vendors || vendors.length === 0 ? (
          <p className="text-gray-500 text-center py-8">
            Todavía no hay locales cargados. ¡Volvé pronto!
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {vendors.map((v: any) => (
              <Link key={v.id} href={`/tienda/${v.slug}`} className="block">
                <Card className="hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                  {v.image_url ? (
                    <div className="h-32 w-full">
                      <img
                        src={v.image_url}
                        alt={v.store_name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="h-32 w-full bg-gradient-to-br from-amber-100 to-orange-200 flex items-center justify-center">
                      <span className="text-5xl font-bold text-orange-400">
                        {v.store_name.charAt(0)}
                      </span>
                    </div>
                  )}
                  <CardContent className="p-5">
                    <h3 className="font-bold text-lg">{v.store_name}</h3>
                    {v.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {v.description}
                      </p>
                    )}
                    <p className="text-xs text-gray-400 mt-2">
                      Ver menú y pedir
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {rest.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Todo el menú del barrio</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {rest.map((o: any) => (
              <OfferCard
                key={o.id}
                name={o.name}
                description={o.description}
                price={Number(o.price)}
                category={o.category}
                storeName={o.vendors?.store_name || ""}
                storeSlug={o.vendors?.slug || ""}
                imageUrl={o.image_url}
              />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
