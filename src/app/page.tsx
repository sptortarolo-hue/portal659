import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { ZONE, VERTICALS } from "@/lib/config";
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
    .select("*, vendors(id, slug, store_name, vertical)")
    .in("neighborhood", ZONE.slugs)
    .eq("available", true)
    .order("featured_today", { ascending: false })
    .order("created_at", { ascending: false });

  const featured =
    offers?.filter(
      (o: any) => o.featured_today && o.vendors?.vertical !== "servicio"
    ) || [];
  const rest =
    offers?.filter(
      (o: any) => !o.featured_today && o.vendors?.vertical !== "servicio"
    ) || [];

  const verticalSlug = (v: any) =>
    ["gastronomia", "almacen", "servicio"].includes(v.vertical)
      ? v.vertical
      : "gastronomia";

  const vendorsByVertical: Record<string, any[]> = {};
  for (const vert of VERTICALS) vendorsByVertical[vert.slug] = [];
  for (const v of vendors || []) {
    const s = verticalSlug(v);
    if (vendorsByVertical[s]) vendorsByVertical[s].push(v);
  }

  return (
    <main>
      <section className="bg-primary text-white">
        <div className="container mx-auto px-4 py-20 text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-sun mb-4">
            {ZONE.name} · 0% comisión
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl max-w-4xl mx-auto">
            El centro comercial de tu barrio,{" "}
            <span className="text-sun">en tu pantalla</span>
          </h1>
          <p className="mt-6 text-lg text-white/85 max-w-2xl mx-auto">
            Comida, almacenes y servicios de Sicardi y Garibaldi en un solo
            lugar. Pedís o consultás, y todo cae directo al WhatsApp del
            comercio.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href="#gastronomia"
              className="rounded-md bg-sun text-ink px-6 py-3 text-sm font-semibold hover:bg-sun/90"
            >
              Ver los comercios
            </Link>
            <Link
              href="/register"
              className="rounded-md border border-white/30 bg-white/10 px-6 py-3 text-sm font-medium hover:bg-white/20"
            >
              Sumá tu comercio gratis
            </Link>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8">
        <nav className="flex flex-wrap justify-center gap-2">
          {VERTICALS.map((vert) => (
            <a
              key={vert.slug}
              href={`#${vert.slug}`}
              className={`rounded-full border border-${vert.color}/30 bg-${vert.color}/5 px-4 py-1.5 text-sm font-medium text-${vert.color} hover:bg-${vert.color}/10`}
            >
              {vert.emoji} {vert.name}
            </a>
          ))}
        </nav>
      </section>

      {featured.length > 0 && (
        <section className="container mx-auto px-4 mb-12" id="hoy">
          <div className="rounded-2xl border border-sun/40 bg-gradient-to-r from-secondary to-accent p-6 mb-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="rounded-full bg-sun px-3 py-1 text-xs font-semibold uppercase tracking-widest text-ink">
                Hoy
              </span>
              <div>
                <h2 className="font-display text-2xl font-semibold">
                  La oferta de hoy
                </h2>
                <p className="text-sm text-muted-foreground">
                  Lo que los comercios de {ZONE.name} te recomiendan hoy
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

      {VERTICALS.map((vert) => {
        const list = vendorsByVertical[vert.slug] || [];
        return (
          <section
            key={vert.slug}
            className="container mx-auto px-4 mb-12 scroll-mt-20"
            id={vert.slug}
          >
            <h2 className="font-display text-3xl font-semibold mb-2 flex items-center gap-2">
              <span className={`inline-block h-3 w-3 rounded-full bg-${vert.color}`}></span>
              {vert.name}
            </h2>
            <p className="text-muted-foreground mb-6">{vert.description}</p>
            {list.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                Todavía no hay comercios de {vert.name.toLowerCase()} en la
                zona. ¡Volvé pronto!
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {list.map((v: any) => (
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
                        <div className="h-32 w-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
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
                          {v.vertical === "servicio"
                            ? "Ver y contactar →"
                            : "Ver menú y pedir →"}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}

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
