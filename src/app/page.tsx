import Link from "next/link";
import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { getZone } from "@/lib/zone";
import { OfferCard } from "@/components/offers/offer-card";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { VendorCard } from "@/components/store/vendor-card";
import { MostOrderedSection } from "@/components/home/most-ordered-section";
import type { Vendor, Product } from "@/types/database";

type OfferWithVendor = Product & {
  vendors: { id: string; slug: string; store_name: string; vertical: string } | null;
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Portal 659 — El centro comercial de tu barrio",
  description:
    "Comercios de Sicardi y Garibaldi en una sola pantalla: gastronomía, almacenes, moda y servicios. Pedí por WhatsApp directo y 0% comisión. Descubrí la oferta de hoy y la info del barrio.",
};

export default async function HomePage() {
  const zone = await getZone();
  const vendors = await queryMany<Vendor>(
    `SELECT * FROM vendors WHERE visible = true AND neighborhood = ANY($1) ORDER BY created_at DESC`,
    [zone.neighborhoods]
  );

  const offers = await queryMany<OfferWithVendor>(
    `SELECT p.*, json_build_object('id', v.id, 'slug', v.slug, 'store_name', v.store_name, 'vertical', v.vertical) AS vendors
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id
     WHERE p.neighborhood = ANY($1) AND p.available = true AND v.visible = true
     ORDER BY p.featured_today DESC, p.created_at DESC`,
    [zone.neighborhoods]
  );

  const featured =
    (offers || [])?.filter(
      (o) => o.featured_today && o.vendors?.vertical !== "servicio"
    ) || [];
  const rest =
    (offers || [])?.filter(
      (o) => !o.featured_today && o.vendors?.vertical !== "servicio"
    ) || [];
  const destacados = (vendors || []).filter((v) => v.featured);

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
            {zone.name} · 0% comisión
          </p>
          <h1
            className="font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl max-w-4xl mx-auto text-white animate-fade-in-up"
            style={{ animationDelay: "0.1s" }}
          >
            El centro comercial del barrio
            <br />
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
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
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
                  Lo que los comercios de {zone.name} te recomiendan hoy
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

      {/* Most ordered */}
      <MostOrderedSection />

      {/* Destacados del barrio */}
      {destacados.length > 0 && (
        <section className="container mx-auto px-4 py-8" id="destacados">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⭐</span>
              <div>
                <h2 className="font-display text-2xl font-semibold">
                  Destacados del barrio
                </h2>
                <p className="text-sm text-muted-foreground">
                  Comercios que la comunidad elige en {zone.name}
                </p>
              </div>
            </div>
          </div>
          <HorizontalCarousel>
            {destacados.map((v) => (
              <VendorCard
                key={v.id}
                id={v.id}
                slug={v.slug}
                store_name={v.store_name}
                image_url={v.image_url}
                logo_url={v.logo_url}
                description={v.description}
                vertical={v.vertical}
                hours={(v as any).hours}
              />
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
                  <VendorCard
                    key={v.id}
                    id={v.id}
                    slug={v.slug}
                    store_name={v.store_name}
                    image_url={v.image_url}
                    logo_url={v.logo_url}
                    description={v.description}
                    vertical={v.vertical}
                    hours={(v as any).hours}
                  />
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
