import Link from "next/link";
import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { getZone } from "@/lib/zone";
import { vendorSellsOnline, resolveVendorPlan } from "@/lib/plans";
import { OfferCard } from "@/components/offers/offer-card";
import { ServiceOfferCard } from "@/components/offers/service-offer-card";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { VendorCard } from "@/components/store/vendor-card";
import { MostOrderedSection } from "@/components/home/most-ordered-section";
import { OpenNowSection } from "@/components/home/open-now-section";
import { BackButtonGuard } from "@/components/home/back-button-guard";
import { SectionHeading } from "@/components/home/section-heading";
import { VerticalIcon, verticalIconComponent } from "@/components/home/vertical-icon";
import { fetchRankStats, rankVendors } from "@/lib/ranking";
import { ArrowRight, CalendarDays, Compass, Flame, MapPin, Newspaper, Sparkles, TrendingUp } from "lucide-react";
import { itemListJsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/json-ld";
import type { Vendor, Plan, Product } from "@/types/database";

type OfferWithVendor = Product & {
  vendors: { id: string; slug: string; store_name: string; vertical: string } | null;
};

export const dynamic = "force-dynamic";

// Zona activa única (Sicardi y Garibaldi): el título menciona el barrio
// explícito porque es la búsqueda objetivo ("comercios/kioscos en Sicardi").
export const metadata = {
  title: "Portal 659 — Comercios, kioscos y delivery en Sicardi y Garibaldi",
  description:
    "Comercios de Sicardi y Garibaldi (La Plata) en una sola pantalla: kioscos, almacenes, gastronomía, moda y servicios. Pedí online o por WhatsApp directo, 0% comisión. Ofertas de hoy e info del barrio.",
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const zone = await getZone();
  const vendors = await queryMany<Vendor>(
    `SELECT * FROM vendors WHERE visibility = 'public' AND neighborhood = ANY($1) ORDER BY created_at DESC`,
    [zone.neighborhoods]
  );

  const offers = await queryMany<OfferWithVendor>(
    `SELECT p.*, json_build_object('id', v.id, 'slug', v.slug, 'store_name', v.store_name, 'vertical', v.vertical) AS vendors
     FROM products p
     JOIN vendors v ON v.id = p.vendor_id
     WHERE p.neighborhood = ANY($1) AND p.available = true AND v.visibility = 'public'
        AND (COALESCE(to_jsonb(v)->>'carta_visibility', 'public') = 'public' OR p.featured_today = true)
     ORDER BY p.featured_today DESC, p.created_at DESC`,
    [zone.neighborhoods]
  );

  const plans = await queryMany<Plan>(`SELECT * FROM plans ORDER BY sort ASC`);

  // Servicios "oferta del día" (estética): igual que los productos, uno por
  // comercio (el server enforcea la exclusividad al marcar). Tolerante a la
  // migración sin aplicar (si falla, la sección sigue siendo sólo productos).
  let featuredServicesRaw: {
    id: string;
    name: string;
    description: string | null;
    duration_min: number | null;
    price: number | null;
    price_from: number | null;
    price_to: number | null;
    image_url: string | null;
    vendors: { id: string; slug: string; store_name: string; vertical: string } | null;
  }[] = [];
  try {
    featuredServicesRaw = await queryMany<{
      id: string;
      name: string;
      description: string | null;
      duration_min: number | null;
      price: number | null;
      price_from: number | null;
      price_to: number | null;
      image_url: string | null;
      vendors: { id: string; slug: string; store_name: string; vertical: string } | null;
    }>(
      `SELECT s.id, s.name, s.description, s.duration_min,
              s.price::numeric AS price, s.price_from::numeric AS price_from, s.price_to::numeric AS price_to,
              s.image_url,
              json_build_object('id', v.id, 'slug', v.slug, 'store_name', v.store_name, 'vertical', v.vertical) AS vendors
         FROM services s
         JOIN vendors v ON v.id = s.vendor_id
        WHERE s.featured_today = true AND s.active = true
          AND v.visibility = 'public'
          AND COALESCE(to_jsonb(v)->>'carta_visibility', 'public') = 'public'
          AND v.neighborhood = ANY($1)
        ORDER BY s.id DESC`,
      [zone.neighborhoods]
    );
  } catch {
    featuredServicesRaw = [];
  }

  // Oferta del día: una sola por comercio (los destacados viejos con más de
  // una oferta se deduplican acá; el server ya enforcea 1 por vendor).
  // Mezcla productos y servicios: si un comercio tuviera los dos, gana el
  // producto (como hoy) y el servicio queda fuera.
  const seenFeaturedVendors = new Set<string>();
  const featuredProducts =
    (offers || [])?.filter((o) => {
      if (!o.featured_today || o.vendors?.vertical === "servicio") return false;
      const vid = o.vendors?.id;
      if (!vid || seenFeaturedVendors.has(vid)) return false;
      seenFeaturedVendors.add(vid);
      return true;
    }) || [];
  const featuredServices =
    (featuredServicesRaw || []).filter((s: any) => {
      if (!s || !s.vendors?.id || seenFeaturedVendors.has(s.vendors.id)) return false;
      seenFeaturedVendors.add(s.vendors.id);
      return true;
    }) || [];
  // Intercalados para que los servicios no queden siempre al final.
  type FeaturedItem = { kind: "product"; id: string; data: OfferWithVendor } | { kind: "service"; id: string; data: (typeof featuredServices)[number] };
  const featuredItems: FeaturedItem[] = [];
  for (let i = 0; i < Math.max(featuredProducts.length, featuredServices.length); i++) {
    if (featuredProducts[i]) featuredItems.push({ kind: "product", id: featuredProducts[i].id, data: featuredProducts[i] });
    if (featuredServices[i]) featuredItems.push({ kind: "service", id: featuredServices[i].id, data: featuredServices[i] });
  }
  const destacados = (vendors || []).filter((v) => {
    if (v.featured) return true;
    // Prioridad del plan Oficios: servicios con plan vigente también destacan.
    if (v.vertical !== "servicio") return false;
    try {
      const eff = resolveVendorPlan(v, plans || []);
      return eff.slug === "oficios" && (eff.trialActive || eff.active);
    } catch {
      return false;
    }
  });

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

  // Ranking por sección: Destacado > Abierto > Oferta hoy > Boost nuevo >
  // Rating > Pedidos > novedad (src/lib/ranking.ts). Best-effort: si falla,
  // queda el orden de la query.
  const rankStats = await fetchRankStats((vendors || []).map((v) => v.id));
  for (const vert of VERTICALS) {
    vendorsByVertical[vert.slug] = rankVendors(vendorsByVertical[vert.slug] || [], rankStats);
  }

  const onlineByVendor: Record<string, boolean> = {};
  for (const v of vendors || []) onlineByVendor[v.id] = vendorSellsOnline(v, plans || []);

  const serviceProfessionals = ["servicio", "estetica", "salud", "taller"].flatMap(
    (slug) => vendorsByVertical[slug] || []
  );

  // Novedades del barrio: mismos info_items de /barrio, filtrados por zona.
  // Best-effort: si la tabla no está, la sección simplemente no se muestra.
  type InfoItem = {
    id: string;
    category: string;
    title: string;
    body: string | null;
    tags: string[] | null;
    sort: number;
    updated_at: string;
  };
  let barrioNews: InfoItem[] = [];
  try {
    barrioNews = await queryMany<InfoItem>(
      `SELECT id, category, title, body, tags, sort, updated_at
       FROM info_items
       WHERE active = true AND zone = ANY($1)
       ORDER BY sort ASC, created_at ASC
       LIMIT 4`,
      [[zone.slug, ...zone.neighborhoods.filter((n) => n !== zone.slug)]]
    );
  } catch {
    barrioNews = [];
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar").replace(/\/$/, "");
  const jsonLd = [
    websiteJsonLd(siteUrl),
    organizationJsonLd(siteUrl),
    itemListJsonLd(
      (vendors || []).slice(0, 30).map((v) => ({ name: v.store_name, url: `${siteUrl}/tienda/${v.slug}` }))
    ),
  ];

  return (
    <main className="pv2">
      <BackButtonGuard />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Hero corto: buscador + zona (solo cambia el diseño) */}
      <section className="pv2-hero relative overflow-hidden">
        <div className="container mx-auto px-4 pt-10 pb-10 sm:pt-14 sm:pb-14 relative">
          <p className="pv2-eyebrow mb-3 inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {zone.name} · 0% comisión
          </p>
          <h1 className="pv2-title text-3xl sm:text-4xl lg:text-5xl max-w-2xl">
            ¿Qué estás buscando hoy?
          </h1>
          <p className="pv2-subtitle mt-3 max-w-xl">
            Pediles directo a los comercios de tu barrio, sin vueltas.
          </p>

          {/* Buscador grande */}
          <form action="/buscar" method="GET" className="mt-7 max-w-2xl">
            <div className="pv2-search">
              <input
                type="search"
                name="q"
                placeholder="Buscá: pizza, farmacia, ropa, electricista..."
              />
              <button
                type="submit"
                className="pv2-btn pv2-btn-primary h-11 px-5 sm:px-7 text-sm flex-shrink-0"
              >
                Buscar
              </button>
            </div>
          </form>

          {/* Chips de acceso rápido */}
          <div className="mt-5 flex flex-wrap gap-2">
            <a href="#ofertas" className="pv2-pill inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold">
              <Flame className="h-3.5 w-3.5 pv2-icon-accent" strokeWidth={2} aria-hidden="true" />
              Oferta de hoy
            </a>
            <a href="#populares" className="pv2-pill inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold">
              <TrendingUp className="h-3.5 w-3.5 pv2-icon-accent" strokeWidth={2} aria-hidden="true" />
              Lo más pedido
            </a>
            <Link href="/buscar" className="pv2-pill inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold">
              <Compass className="h-3.5 w-3.5 pv2-icon-accent" strokeWidth={2} aria-hidden="true" />
              Ver todo
            </Link>
          </div>
        </div>
      </section>

      {/* Categorías: carrusel de píldoras con íconos vectoriales */}
      <section className="container mx-auto px-4 py-10 sm:py-12" id="categorias">
        <HorizontalCarousel>
          {VERTICALS.map((vert, i) => (
            <Link
              key={vert.slug}
              href={`/buscar?vertical=${vert.slug}`}
              className="pv2-card flex min-w-[180px] max-w-[210px] snap-start flex-col gap-3 p-4 animate-fade-in-up"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <span className="pv2-section-icon h-11 w-11">
                <VerticalIcon slug={vert.slug} className="h-5 w-5" />
              </span>
              <span className="pv2-title text-sm leading-tight">{vert.name}</span>
              <span className="pv2-subtitle text-[11px]">
                {(vendorsByVertical[vert.slug] || []).length} comercios
              </span>
            </Link>
          ))}
        </HorizontalCarousel>
      </section>

      {/* Banner de promociones (un solo banner, sin saturar) */}
      <section className="container mx-auto px-4 pb-2">
        <div className="pv2-card relative overflow-hidden bg-gradient-to-r from-[#eef0ff] to-[#f7fbe9] px-5 py-5 sm:px-7 sm:py-6">
          <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="pv2-section-icon h-12 w-12">
                <Flame className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <div>
                <h2 className="pv2-title text-lg sm:text-xl">Oferta de hoy</h2>
                <p className="pv2-subtitle text-sm">
                  Pediles directo a los comercios de tu barrio, sin vueltas.
                </p>
              </div>
            </div>
            <a href="#ofertas" className="pv2-btn pv2-btn-primary px-5 py-2.5 text-sm flex-shrink-0">
              Ver ofertas
              <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* Abiertos ahora (cliente — zona horaria del usuario) */}
      <OpenNowSection vendors={rankVendors(vendors || [], rankStats)} onlineByVendor={onlineByVendor} />

      {/* Oferta de hoy (productos y servicios destacados, uno por comercio) */}
      {featuredItems.length > 0 && (
        <section className="container mx-auto px-4 py-10 sm:py-12 scroll-mt-20" id="ofertas">
          <SectionHeading
            icon={Flame}
            eyebrow="Hoy"
            title="La oferta de hoy"
            description={`Lo que los comercios de ${zone.name} te recomiendan hoy`}
          />
          <HorizontalCarousel>
            {featuredItems.map((it) =>
              it.kind === "product" ? (
                <div key={`p-${it.id}`} className="flex min-w-[280px] max-w-[320px] snap-start">
                  <OfferCard
                    name={it.data.name}
                    description={it.data.description}
                    price={Number(it.data.price)}
                    promoPrice={it.data.promo_price != null ? Number(it.data.promo_price) : null}
                    category={it.data.category}
                    storeName={it.data.vendors?.store_name || ""}
                    storeSlug={it.data.vendors?.slug || ""}
                    offerId={it.data.id}
                    featured
                    imageUrl={it.data.image_url}
                    vertical={it.data.vendors?.vertical || null}
                  />
                </div>
              ) : (
                <div key={`s-${it.id}`} className="flex min-w-[280px] max-w-[320px] snap-start">
                  <ServiceOfferCard
                    name={it.data.name}
                    description={it.data.description}
                    durationMin={it.data.duration_min != null ? Number(it.data.duration_min) : null}
                    price={it.data.price != null ? Number(it.data.price) : null}
                    priceFrom={it.data.price_from != null ? Number(it.data.price_from) : null}
                    priceTo={it.data.price_to != null ? Number(it.data.price_to) : null}
                    storeName={it.data.vendors?.store_name || ""}
                    storeSlug={it.data.vendors?.slug || ""}
                    imageUrl={it.data.image_url}
                    featured
                    vertical={it.data.vendors?.vertical || null}
                  />
                </div>
              )
            )}
          </HorizontalCarousel>
        </section>
      )}

      {/* Lo más pedido */}
      <div id="populares">
        <MostOrderedSection />
      </div>

      {/* Servicios y profesionales */}
      {serviceProfessionals.length > 0 && (
        <section className="container mx-auto px-4 py-10 sm:py-12" id="profesionales">
          <SectionHeading
            icon={CalendarDays}
            title="Servicios y profesionales"
            description="Turnos, consultas y profesionales del barrio"
            count={serviceProfessionals.length}
          />
          <HorizontalCarousel>
            {serviceProfessionals.map((v) => (
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
                open_override={v.open_override ?? null}
                acceptsCart={onlineByVendor[v.id] ?? null}
              />
            ))}
          </HorizontalCarousel>
        </section>
      )}

      {/* Destacados del barrio */}
      {destacados.length > 0 && (
        <section className="container mx-auto px-4 py-10 sm:py-12 scroll-mt-20" id="destacados">
          <SectionHeading
            icon={Sparkles}
            title="Destacados del barrio"
            description={`Comercios que la comunidad elige en ${zone.name}`}
          />
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
                open_override={v.open_override ?? null}
                acceptsCart={onlineByVendor[v.id] ?? null}
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
            className="container mx-auto px-4 py-10 sm:py-12 scroll-mt-20"
            id={vert.slug}
          >
            <SectionHeading
              icon={verticalIconComponent(vert.slug)}
              title={vert.name}
              description={vert.description}
              count={list.length}
            />
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
                  open_override={v.open_override ?? null}
                  acceptsCart={onlineByVendor[v.id] ?? null}
                />
              ))}
            </HorizontalCarousel>
          </section>
        );
      })}

      {/* Novedades del barrio */}
      {barrioNews.length > 0 && (
        <section className="container mx-auto px-4 py-10 sm:py-12" id="novedades">
          <SectionHeading
            icon={Newspaper}
            title="Novedades del barrio"
            description={`Lo que pasa en ${zone.name}`}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {barrioNews.map((item) => (
              <article key={item.id} className="pv2-card flex h-full flex-col p-5">
                <h3 className="pv2-title text-sm">{item.title}</h3>
                {item.body && (
                  <p className="pv2-subtitle mt-2 line-clamp-3 text-xs">{item.body}</p>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
                  {(item.tags || []).slice(0, 3).map((tag) => (
                    <span key={tag} className="pv2-chip pv2-chip-muted">#{tag}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <Link
            href="/barrio"
            className="pv2-btn pv2-btn-outline mt-6 px-5 py-2.5 text-sm"
          >
            Ver toda la info del barrio
            <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </Link>
        </section>
      )}

      {/* CTA vendor al final */}
      <section className="container mx-auto px-4 py-12 sm:py-16">
        <div className="pv2-cta relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14 text-center">
          <div className="relative z-10">
            <p className="pv2-eyebrow mb-3">Para comercios</p>
            <h2 className="pv2-title text-2xl sm:text-3xl max-w-2xl mx-auto">
              ¿Tenés un comercio? Hacelo trabajar mejor
            </h2>
            <p className="pv2-cta-lead mt-3 text-sm sm:text-base max-w-xl mx-auto">
              Pedidos ordenados, catálogo, QR y WhatsApp directo. Empezá gratis, 0% comisión.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                href="/register"
                className="pv2-btn pv2-btn-primary px-8 py-3 text-sm"
              >
                Creá tu comercio gratis
              </Link>
              <Link
                href="/comercios"
                className="pv2-btn pv2-btn-outline border-white/40 px-7 py-3 text-sm text-white"
              >
                Conocé cómo funciona →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
