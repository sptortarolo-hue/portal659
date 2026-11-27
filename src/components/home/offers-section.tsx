import { Flame } from "lucide-react";
import { OfferCard } from "@/components/offers/offer-card";
import { ServiceOfferCard } from "@/components/offers/service-offer-card";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { SectionHeading } from "@/components/home/section-heading";
import { OfferCountdown } from "@/components/home/offer-countdown";

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

/** Vitrina de ofertas: una tarjeta por producto/servicio destacado, cada una con su foto. */
export function OffersSection({ items, zoneName }: { items: FeaturedOfferItem[]; zoneName: string }) {
  if (items.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-10 sm:py-12 scroll-mt-20" id="ofertas">
      <SectionHeading
        icon={Flame}
        eyebrow="Hoy"
        title="Ofertas del día"
        description={`Los productos y servicios que los comercios de ${zoneName} destacan hoy`}
        rightSlot={<OfferCountdown />}
      />
      <HorizontalCarousel>
        {items.map((it, i) => (
          <div
            key={`${it.kind}-${it.id}`}
            className="flex min-w-[250px] max-w-[310px] snap-start animate-fade-in-up"
            style={{ animationDelay: `${(i % 8) * 0.06}s` }}
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
                featured
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
                featured
                vertical={it.vertical}
              />
            )}
          </div>
        ))}
      </HorizontalCarousel>
    </section>
  );
}
