"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Flame, TrendingUp } from "lucide-react";
import { SectionHeading } from "@/components/home/section-heading";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { ProductImage } from "@/components/product-image";

type MostOrderedItem = {
  product_id: string;
  product_name: string;
  total_qty: number;
  store_name: string;
  store_slug: string;
  store_vertical: string;
  image_url?: string | null;
  category?: string | null;
};

/** Count-up corto y cleanup; el valor final y el texto los decide el caller. */
function useCountUp(target: number) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    setValue(0);
    if (target <= 0) return;

    const step = Math.max(1, Math.ceil(target / 25));
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(target, current + step);
      setValue(current);
      if (current >= target) clearInterval(timer);
    }, 40);

    return () => clearInterval(timer);
  }, [target]);

  return value;
}

function RankedCard({ item, index }: { item: MostOrderedItem; index: number }) {
  const sold = useCountUp(item.total_qty);

  return (
    <Link
      href={`/tienda/${item.store_slug}?menu=1&oferta=${encodeURIComponent(item.product_id)}`}
      className="block min-w-[220px] max-w-[260px] snap-start group animate-fade-in-up"
      style={{ animationDelay: `${index * 90}ms` }}
    >
      <div className="pv2-card h-full overflow-hidden">
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
          <ProductImage
            src={item.image_url ?? null}
            name={item.product_name}
            category={item.category ?? null}
            vertical={item.store_vertical}
            alt={item.product_name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            iconClassName="h-10 w-10"
          />
        </div>
        <div className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="pv2-chip">#{index + 1}</span>
          <span className="pv2-section-icon h-8 w-8">
            <Flame className="h-4 w-4 pv2-icon-accent" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="pv2-chip ml-auto whitespace-nowrap tabular-nums">
            {sold} vendidos
          </span>
        </div>
        <p className="pv2-title truncate text-sm leading-tight">
          {item.product_name}
        </p>
        <p className="pv2-subtitle mt-1 truncate text-xs">
          {item.store_name}
        </p>
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          Ver tienda →
        </p>
        </div>
      </div>
    </Link>
  );
}

export function MostOrderedSection() {
  const [items, setItems] = useState<MostOrderedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/products/most-ordered?days=7&limit=5")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const heading = (
    <SectionHeading
      icon={TrendingUp}
      eyebrow="Popular"
      title="Lo más pedido del barrio"
      description="Lo que más pidieron en los últimos 7 días"
    />
  );

  if (loading) {
    return (
      <section className="container mx-auto px-4 py-10 sm:py-12" aria-busy="true">
        {heading}
        <HorizontalCarousel>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="min-w-[220px] max-w-[260px] snap-start">
              <div className="pv2-card h-full overflow-hidden">
                <div className="pv2-skeleton aspect-[4/3] w-full" />
                <div className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="pv2-skeleton h-8 w-8" />
                  <span className="pv2-skeleton h-5 w-16" />
                </div>
                <div className="pv2-skeleton h-4 w-4/5" />
                <div className="pv2-skeleton mt-2 h-3 w-3/5" />
                <div className="pv2-skeleton mt-3 h-3 w-24" />
                </div>
              </div>
            </div>
          ))}
        </HorizontalCarousel>
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-10 sm:py-12">
      {heading}
      <HorizontalCarousel>
        {items.map((item, index) => (
          <RankedCard key={item.product_id} item={item} index={index} />
        ))}
      </HorizontalCarousel>
    </section>
  );
}
