"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Flame, TrendingUp } from "lucide-react";
import { SectionHeading } from "@/components/home/section-heading";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";

type MostOrderedItem = {
  product_id: string;
  product_name: string;
  total_qty: number;
  store_name: string;
  store_slug: string;
  store_vertical: string;
};

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

  if (loading || items.length === 0) return null;

  return (
    <section className="container mx-auto px-4 py-10 sm:py-12">
      <SectionHeading
        icon={TrendingUp}
        eyebrow="Popular"
        title="Lo más pedido del barrio"
        description="Lo que más pidieron en los últimos 7 días"
      />
      <HorizontalCarousel>
        {items.map((item) => (
          <Link
            key={item.product_id}
            href={`/tienda/${item.store_slug}?menu=1&oferta=${encodeURIComponent(item.product_id)}`}
            className="min-w-[220px] max-w-[260px] snap-start block group"
          >
            <div className="pv2-card h-full p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="pv2-section-icon h-8 w-8">
                  <Flame className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="pv2-chip">{item.total_qty} vendidos</span>
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
          </Link>
        ))}
      </HorizontalCarousel>
    </section>
  );
}
