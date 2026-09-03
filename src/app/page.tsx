import Link from "next/link";
import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { getZone } from "@/lib/zone";
import { OfferCard } from "@/components/offers/offer-card";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { VendorCard } from "@/components/store/vendor-card";
import { MostOrderedSection } from "@/components/home/most-ordered-section";
import { OpenNowSection } from "@/components/home/open-now-section";
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
      {/* Hero corto: buscador + zone */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary/90 to-primary">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(163,230,53,0.15),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(255,255,255,0.08),transparent_50%)]" />
        <div className="container mx-auto px-4 pt-8 pb-8 sm:pt-12 sm:pb-12 relative z-10">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-sun mb-2">
            📍 {zone.name} · 0% comisión
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl text-white max-w-2xl">
            ¿Qué te hace falta hoy?
          </h1>
          <p className="mt-2 text-sm text-white/80 max-w-xl">
            Pediles directo a los comercios de tu barrio, sin vueltas.
          </p>

          {/* Buscador grande */}
          <form action="/buscar" method="GET" className="mt-5 max-w-xl">
            <div className="flex items-center gap-2 rounded-2xl bg-white shadow-lg p-1.5">
              <input
                type="search"
                name="q"
                placeholder="Buscá: pizza, farmacia, ropa, electricista..."
                className="flex-1 min-w-0 bg-transparent px-3 text-sm text-ink placeholder:text-gray-400 outline-none h-10"
              />
              <button
                type="submit"
                className="flex-shrink-0 rounded-xl bg-sun text-ink px-4 sm:px-6 h-10 text-sm font-bold hover:bg-sun/90 transition-colors"
              >
                Buscar
              </button>
            </div>
          </form>

          {/* Chips de acceso rápido */}
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="#ofertas" className="rounded-full bg-white/10 border border-white/20 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors">
              🔥 Oferta de hoy
            </a>
            <a href="#populares" className="rounded-full bg-white/10 border border-white/20 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors">
              ⭐ Lo más pedido
            </a>
            <Link href="/buscar" className="rounded-full bg-white/10 border border-white/20 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors">
              🧭 Ver todo
            </Link>
          </div>
        </div>
      </section>

      {/* Categorías */}
      <section className="container mx-auto px-4 py-6" id="categorias">
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          {VERTICALS.map((vert, i) => (
            <Link
              key={vert.slug}
              href={`/buscar?vertical=${vert.slug}`}
              className="flex flex-col items-center gap-2 p-3 rounded-2xl border border-border bg-card hover:shadow-lg hover:border-primary/30 transition-all duration-200 hover:-translate-y-0.5 animate-fade-in-up"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <span className="text-3xl">{vert.emoji}</span>
              <span className="text-[11px] font-medium text-muted-foreground text-center leading-tight">
                {vert.name}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Abiertos ahora (cliente — zona horaria del usuario) */}
      <OpenNowSection vendors={vendors || []} />

      {/* Oferta de hoy */}
      {featured.length > 0 && (
        <section className="container mx-auto px-4 py-6" id="ofertas">
          <div className="rounded-2xl border border-sun/40 bg-gradient-to-r from-warm to-accent p-4 sm:p-6 mb-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="rounded-full bg-sun px-3 py-1 text-xs font-semibold uppercase tracking-widest text-ink">
                Hoy
              </span>
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-semibold">
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
                  vertical={o.vendors?.vertical || null}
                />
              </div>
            ))}
          </HorizontalCarousel>
        </section>
      )}

      {/* Lo más pedido */}
      <div id="populares">
        <MostOrderedSection />
      </div>

      {/* Destacados del barrio */}
      {destacados.length > 0 && (
        <section className="container mx-auto px-4 py-6" id="destacados">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">⭐</span>
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-semibold">
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
                hours={v.hours}
              />
            ))}
          </HorizontalCarousel>
        </section>
      )}

      {/* Comercios por vertical (oculta las secciones vacías) */}
      {VERTICALS.map((vert) => {
        const list = vendorsByVertical[vert.slug] || [];
        if (list.length === 0) return null;
        return (
          <section
            key={vert.slug}
            className="container mx-auto px-4 mb-6 scroll-mt-20"
            id={vert.slug}
          >
            <div className="flex items-center justify-between mb-3">
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
              <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
                {list.length}
              </span>
            </div>
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
                  hours={v.hours}
                />
              ))}
            </HorizontalCarousel>
          </section>
        );
      })}

      {/* CTA vendor al final */}
      <section className="container mx-auto px-4 py-10">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-primary/80 p-6 sm:p-10 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(163,230,53,0.2),transparent_50%)]" />
          <div className="relative z-10">
            <p className="text-xs font-semibold tracking-widest uppercase text-sun mb-3">
              Para comercios
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-white max-w-2xl mx-auto">
              ¿Tenés un comercio en el barrio? Sumalo gratis
            </h2>
            <p className="mt-3 text-sm sm:text-base text-white/80 max-w-xl mx-auto">
              Tu micrositio con QR en minutos — catálogo, pedidos y WhatsApp directo. 0% comisión, sin letra chica.
            </p>
            <Link
              href="/register"
              className="inline-block mt-6 rounded-full bg-sun text-ink px-8 py-3 text-sm font-bold hover:bg-sun/90 transition-all hover:scale-105 active:scale-95 shadow-lg"
            >
              Creá tu comercio gratis
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
