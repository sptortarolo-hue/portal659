"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { OfferCard } from "@/components/offers/offer-card";
import { ServiceOfferCard } from "@/components/offers/service-offer-card";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { SectionHeading } from "@/components/home/section-heading";

export type FeaturedOfferItem =
  | {
      kind: "product";
      id: string;
      name: string;
      description: string | null;
      price: number;
      promoPrice: number | null;
      category: string | null;
      storeName: string;
      storeSlug: string;
      imageUrl: string | null;
      vertical: string | null;
    }
  | {
      kind: "service";
      id: string;
      name: string;
      description: string | null;
      durationMin: number | null;
      price: number | null;
      priceFrom: number | null;
      priceTo: number | null;
      storeName: string;
      storeSlug: string;
      imageUrl: string | null;
      vertical: string | null;
    };

const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

function spotlightData(item: FeaturedOfferItem) {
  if (item.kind === "product") {
    const promo = item.promoPrice != null && item.promoPrice > 0 && item.promoPrice < item.price
      ? item.promoPrice
      : null;
    return {
      price: money(promo ?? item.price),
      oldPrice: promo != null ? money(item.price) : null,
      discount: promo != null ? Math.round((1 - promo / item.price) * 100) : null,
      href: `/tienda/${item.storeSlug}?menu=1&oferta=${encodeURIComponent(item.id)}`,
      cta: "Ver oferta",
    };
  }
  return {
    price: item.price != null ? money(item.price) : item.priceFrom != null ? `Desde ${money(item.priceFrom)}` : "Consultar",
    oldPrice: null,
    discount: null,
    href: `/tienda/${item.storeSlug}#reservar-turno`,
    cta: "Reservar turno",
  };
}

/**
 * Diseño "Split" inspirado en la pantalla TV del portal: a la izquierda un
 * spotlight rotativo con la oferta en escena; a la derecha el carrusel con
 * TODAS las ofertas destacadas. Misma identidad, patrón propio.
 */
export function SplitOffersSection({ items, zoneName }: { items: FeaturedOfferItem[]; zoneName: string }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (paused || reduced || items.length < 2) return;
    const id = setInterval(() => setActive((prev) => (prev + 1) % items.length), 4500);
    return () => clearInterval(id);
  }, [paused, reduced, items.length]);

  if (items.length === 0) return null;

  const current = items[active % items.length];
  const data = spotlightData(current);

  return (
    <section className="container mx-auto scroll-mt-[112px] px-4 py-10 sm:scroll-mt-24 sm:py-12" id="ofertas">
      <SectionHeading
        icon={Sparkles}
        eyebrow="Hoy"
        title="Ofertas del día"
        description={`Los productos y servicios que los comercios de ${zoneName} destacan hoy`}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)]">
        {/* Spotlight rotativo */}
        <div
          className="pv2-card relative h-[280px] overflow-hidden sm:h-[300px]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
          }}
        >
          {current.imageUrl && (
            <div className="absolute inset-0 overflow-hidden" aria-hidden>
              <div
                key={`bg-${current.id}`}
                className="h-full w-full"
                style={{
                  filter: "blur(36px) saturate(1.2)",
                  opacity: 0.55,
                  animation: reduced ? "none" : "pv2-kenburns 12s ease-in-out infinite alternate",
                }}
              >
                <ProductImage
                  src={current.imageUrl}
                  name={current.name}
                  vertical={current.vertical}
                  alt=""
                  fit="cover"
                  iconClassName="h-24 w-24"
                  eager
                />
              </div>
            </div>
          )}
          <ProductImage
            key={`fg-${current.id}`}
            src={current.imageUrl}
            name={current.name}
            vertical={current.vertical}
            alt={current.name}
            fit="contain"
            className={`relative h-full w-full transition-all duration-700 ${reduced ? "" : "animate-fade-in-up"}`}
            iconClassName="h-14 w-14"
            eager
          />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(180deg, rgba(49,46,129,.10) 0%, rgba(49,46,129,.12) 34%, rgba(49,46,129,.62) 72%, rgba(49,46,129,.94) 100%)" }}
          />
          {!reduced && items.length > 1 && (
            <div
              key={`progress-${active}`}
              className="absolute left-0 top-0 z-20 h-1"
              style={{
                background: "var(--pv2-accent)",
                animation: "pv2-progress 4.5s linear forwards",
              }}
            />
          )}

          <div className="absolute inset-x-0 bottom-0 z-10 p-5">
            <div className="mb-2 flex items-center gap-2">
              <span className="pv2-chip">Hoy</span>
              {data.discount != null && <span className="pv2-chip">-{data.discount}%</span>}
              {!reduced && items.length > 1 && (
                <span className="ml-auto flex gap-1.5">
                  {items.slice(0, 6).map((it, i) => (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setActive(i)}
                      aria-label={`Ver oferta ${i + 1}: ${it.name}`}
                      className="h-2 rounded-full border-0 p-0 transition-all"
                      style={{
                        width: i === active % items.length ? 20 : 7,
                        background: i === active % items.length ? "var(--pv2-accent)" : "rgba(255,255,255,.6)",
                      }}
                    />
                  ))}
                </span>
              )}
            </div>
            <h3 className="pv2-title text-lg drop-shadow sm:text-xl" style={{ color: "#ffffff" }}>
              {current.name}
            </h3>
            <p className="mt-1 text-xs text-indigo-100">{current.storeName}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                {data.oldPrice && <span className="pv2-price-old mr-2">{data.oldPrice}</span>}
                <span className="pv2-price" style={{ color: "#ffffff", fontSize: "1.15rem" }}>{data.price}</span>
              </div>
              <Link href={data.href} className="pv2-btn pv2-btn-primary px-3 py-2 text-[11px]">
                {data.cta}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        {/* Carrusel de todas las ofertas */}
        <div className="min-w-0">
          <p className="pv2-subtitle mb-3 text-xs font-semibold uppercase tracking-wider">
            Todas las ofertas de hoy · {items.length}
          </p>
          <HorizontalCarousel>
            {items.map((it, i) => (
              <div
                key={`${it.kind}-${it.id}`}
                className="flex min-w-[220px] max-w-[270px] snap-start animate-fade-in-up rounded-[18px]"
                style={{
                  animationDelay: `${(i % 8) * 0.06}s`,
                  boxShadow: i === active % items.length ? "0 0 0 2px var(--pv2-accent)" : undefined,
                }}
                onClick={() => setActive(i)}
              >
                {it.kind === "product" ? (
                  <OfferCard
                    name={it.name}
                    description={it.description}
                    price={it.price}
                    promoPrice={it.promoPrice}
                    category={it.category}
                    storeName={it.storeName}
                    storeSlug={it.storeSlug}
                    offerId={it.id}
                    imageUrl={it.imageUrl}
                    vertical={it.vertical}
                  />
                ) : (
                  <ServiceOfferCard
                    name={it.name}
                    description={it.description}
                    durationMin={it.durationMin}
                    price={it.price}
                    priceFrom={it.priceFrom}
                    priceTo={it.priceTo}
                    storeName={it.storeName}
                    storeSlug={it.storeSlug}
                    imageUrl={it.imageUrl}
                    vertical={it.vertical}
                  />
                )}
              </div>
            ))}
          </HorizontalCarousel>
        </div>
      </div>
    </section>
  );
}
