import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { ZONE } from "@/lib/config";
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
    .in("neighborhood", ZONE.slugs)
    .order("created_at", { ascending: false });

  const { data: offers } = await supabase
    .from("products")
    .select("*, vendors(id, slug, store_name)")
    .in("neighborhood", ZONE.slugs)
    .eq("available", true)
    .order("featured_today", { ascending: false })
    .order("created_at", { ascending: false });

  const featured = offers?.filter((o: any) => o.featured_today) || [];
  const rest = offers?.filter((o: any) => !o.featured_today) || [];

  return (
    <main>
      <section className="bg-[#171717] text-white border-b border-[#171717]">
        <div className="container mx-auto px-4 py-20 text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-4">
            El delivery de nuestro barrio · {ZONE.name}
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl max-w-4xl mx-auto">
            Donde las aplicaciones grandes no llegan,{" "}
            <span className="text-primary">nosotros te salvamos la cena</span>
          </h1>
          <p className="mt-6 text-lg text-white/80 max-w-2xl mx-auto">
            Pedí comida casera y regional directo a los productores de{" "}
            {ZONE.name}. Sin comisiones, sin intermediarios:
            el pedido cae en el WhatsApp del local.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href="#locales"
              className="rounded-md bg-primary text-primary-foreground px-6 py-3 text-sm font-medium hover:bg-primary/90"
            >
              Ver los locales
            </Link>
            <Link
              href="/register"
              className="rounded-md border border-white/30 bg-white/10 px-6 py-3 text-sm font-medium hover:bg-white/20"
            >
              ¿Tenés un local? Sumate gratis
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-10">
        <div className="flex flex-wrap justify-center gap-2">
          <span className="rounded-full bg-primary text-primary-foreground font-medium px-4 py-1.5 text-sm">
            {ZONE.name}
          </span>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="container mx-auto px-4 mb-12" id="hoy">
          <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-6 mb-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold uppercase tracking-widest text-primary-foreground">
                Hoy
              </span>
              <div>
                <h2 className="font-display text-2xl font-semibold">
                  La oferta de hoy
                </h2>
                <p className="text-sm text-muted-foreground">
                  Lo que los locales de {ZONE.name} te
                  recomiendan hoy
                </p>
              </div>
            </div>
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

      <section className="container mx-auto px-4 mb-12" id="locales">
        <h2 className="font-display text-3xl font-semibold mb-2">
          Los locales de {ZONE.name}
        </h2>
        <p className="text-muted-foreground mb-6">
          Cada local tiene su propia vidriera. Tocá para ver su menú y pedir
          por WhatsApp.
        </p>
        {!vendors || vendors.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            Todavía no hay locales cargados. ¡Volvé pronto!
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {vendors.map((v: any) => (
              <Link key={v.id} href={`/tienda/${v.slug}`} className="block">
                <Card className="relative hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
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
                      <span className="font-display text-5xl font-bold text-primary/70">
                        {v.store_name.charAt(0)}
                      </span>
                    </div>
                  )}
                  {v.logo_url && (
                    <img
                      src={v.logo_url}
                      alt={`Logo de ${v.store_name}`}
                      className="absolute left-4 top-4 h-14 w-14 rounded-full object-cover border-2 border-white shadow"
                    />
                  )}
                  <CardContent className="p-5">
                    <h3 className="font-display text-xl font-semibold">
                      {v.store_name}
                    </h3>
                    {v.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {v.description}
                      </p>
                    )}
                    <p className="text-xs text-primary mt-3 font-medium">
                      Ver menú y pedir →
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {rest.length > 0 && (
        <section className="container mx-auto px-4 pb-12">
          <h2 className="font-display text-3xl font-semibold mb-6">
            Todo el menú del barrio
          </h2>
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
