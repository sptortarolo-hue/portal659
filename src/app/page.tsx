import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import { ZONE, VERTICALS } from "@/lib/config";
import { OfferCard } from "@/components/offers/offer-card";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import type { Vendor, Product } from "@/types/database";

type OfferWithVendor = Product & {
  vendors: { id: string; slug: string; store_name: string; vertical: string } | null;
};

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
    (offers as OfferWithVendor[] | null)?.filter(
      (o) => o.featured_today && o.vendors?.vertical !== "servicio"
    ) || [];
  const rest =
    (offers as OfferWithVendor[] | null)?.filter(
      (o) => !o.featured_today && o.vendors?.vertical !== "servicio"
    ) || [];

  const verticalSlug = (v: Vendor): string => {
    const valid: string[] = VERTICALS.map((v) => v.slug);
    return valid.includes(v.vertical as string) ? v.vertical : "gastronomia";
  };

  const vendorsByVertical: Record<string, Vendor[]> = {};
  for (const vert of VERTICALS) vendorsByVertical[vert.slug] = [];
  for (const v of vendors || []) {
    const s = verticalSlug(v);
    if (vendorsByVertical[s]) vendorsByVertical[s].push(v);
  }

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(163,230,53,0.15),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.08),transparent_50%)]" />
        <div className="container mx-auto px-4 py-16 sm:py-24 text-center relative z-10">
          <p className="text-xs font-semibold tracking-widest uppercase text-sun mb-4 animate-fade-in-up">
            {ZONE.name} · 0% comisión
          </p>
          <h1
            className="font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl max-w-4xl mx-auto text-white animate-fade-in-up"
            style={{ animationDelay: "0.1s" }}
          >
            El centro comercial del barrio,{" "}
            <span className="text-sun">en tu pantalla</span>
          </h1>
          <p
            className="mt-6 text-lg text-white/80 max-w-2xl mx-auto animate-fade-in-up"
            style={{ animationDelay: "0.2s" }}
          >
            Gastronomía, comercio, servicios, moda, salud y más en un solo
            lugar. Elegís - Consultas - Pedís y Disfrutas.
          </p>
          <div
            className="mt-10 flex flex-wrap justify-center gap-3 animate-fade-in-up"
            style={{ animationDelay: "0.3s" }}
          >
            <Link
              href="#categorias"
              className="rounded-full bg-sun text-ink px-8 py-3 text-sm font-semibold hover:bg-sun/90 transition-all hover:scale-105 active:scale-95 shadow-lg"
            >
              Explorar comercios
            </Link>
            <Link
              href="/register"
              className="rounded-full border border-white/30 bg-white/10 px-8 py-3 text-sm font-medium hover:bg-white/20 transition-all"
            >
              Sumá tu comercio gratis
            </Link>
          </div>
        </div>
      </section>

      {/* Categorías grandes */}
      <section className="container mx-auto px-4 py-8" id="categorias">
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
          {VERTICALS.map((vert, i) => (
            <a
              key={vert.slug}
              href={`#${vert.slug}`}
              className="flex flex-col items-center gap-2 p-3 rounded-2xl border border-border bg-card hover:shadow-lg hover:border-primary/30 transition-all duration-200 hover:-translate-y-0.5 animate-fade-in-up"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <span className="text-3xl">{vert.emoji}</span>
              <span className="text-[11px] font-medium text-muted-foreground text-center leading-tight">
                {vert.name}
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* Featured (La oferta de hoy) */}
      {featured.length > 0 && (
        <section className="container mx-auto px-4 py-8" id="hoy">
          <div className="rounded-2xl border border-sun/40 bg-gradient-to-r from-warm to-accent p-6 mb-6">
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
          <HorizontalCarousel>
            {featured.map((o) => (
              <div key={o.id} className="min-w-[280px] max-w-[320px] snap-start">
                <OfferCard
                  name={o.name}
                  description={o.description}
                  price={Number(o.price)}
                  category={o.category}
                  storeName={o.vendors?.store_name || ""}
                  storeSlug={o.vendors?.slug || ""}
                  featured
                  imageUrl={o.image_url}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </section>
      )}

      {/* Vendors by vertical with carousels */}
      {VERTICALS.map((vert) => {
        const list = vendorsByVertical[vert.slug] || [];
        return (
          <section
            key={vert.slug}
            className="container mx-auto px-4 mb-8 scroll-mt-20"
            id={vert.slug}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{vert.emoji}</span>
                <div>
                  <h2 className="font-display text-xl font-semibold">
                    {vert.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {vert.description}
                  </p>
                </div>
              </div>
              {list.length > 0 && (
                <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                  {list.length}
                </span>
              )}
            </div>
            {list.length === 0 ? (
              <p className="text-muted-foreground text-center py-8 text-sm">
                Todavía no hay comercios de{" "}
                {vert.name.toLowerCase()} en la zona. ¡Volvé pronto!
              </p>
            ) : (
              <HorizontalCarousel>
                {list.map((v) => (
                  <Link
                    key={v.id}
                    href={`/tienda/${v.slug}`}
                    className="min-w-[260px] max-w-[300px] snap-start block group"
                  >
                    <div className="relative rounded-2xl border border-border bg-card overflow-hidden hover:shadow-xl transition-all duration-200 hover:-translate-y-1">
                      {v.image_url ? (
                        <div className="h-36 overflow-hidden">
                          <img
                            src={v.image_url}
                            alt={v.store_name}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        </div>
                      ) : (
                        <div className="h-36 bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
                          <span className="font-display text-4xl font-bold text-primary/50">
                            {v.store_name.charAt(0)}
                          </span>
                        </div>
                      )}
                      {v.logo_url && (
                        <img
                          src={v.logo_url}
                          alt={`Logo de ${v.store_name}`}
                          className="absolute left-3 top-3 h-12 w-12 rounded-full object-cover border-2 border-white shadow-md"
                        />
                      )}
                      <div className="p-4">
                        <h3 className="font-display text-base font-semibold truncate">
                          {v.store_name}
                        </h3>
                        {v.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {v.description}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-3">
                          <p className="text-xs text-primary font-medium">
                            {v.vertical === "servicio"
                              ? "Ver y contactar →"
                              : "Ver y pedir →"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </HorizontalCarousel>
            )}
          </section>
        );
      })}

      {/* Rest of offers */}
      {rest.length > 0 && (
        <section className="container mx-auto px-4 py-8">
          <h2 className="font-display text-2xl font-semibold mb-4">
            Más ofertas del barrio
          </h2>
          <HorizontalCarousel>
            {rest.map((o) => (
              <div key={o.id} className="min-w-[280px] max-w-[320px] snap-start">
                <OfferCard
                  name={o.name}
                  description={o.description}
                  price={Number(o.price)}
                  category={o.category}
                  storeName={o.vendors?.store_name || ""}
                  storeSlug={o.vendors?.slug || ""}
                  imageUrl={o.image_url}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </section>
      )}
    </main>
  );
}
