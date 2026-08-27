"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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
    <section className="container mx-auto px-4 py-8">
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/5 to-accent/30 p-6 mb-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold uppercase tracking-widest">
            Popular
          </span>
          <div>
            <h2 className="font-display text-2xl font-semibold">
              Lo más pedido del barrio
            </h2>
            <p className="text-sm text-muted-foreground">
              Lo que más pidieron en los últimos 7 días
            </p>
          </div>
        </div>
      </div>
      <HorizontalCarousel>
        {items.map((item) => (
          <Link
            key={item.product_id}
            href={`/tienda/${item.store_slug}`}
            className="min-w-[220px] max-w-[260px] snap-start block group"
          >
            <div className="rounded-2xl border border-border bg-card p-4 hover:shadow-xl transition-all duration-200 hover:-translate-y-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🔥</span>
                <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {item.total_qty} vendidos
                </span>
              </div>
              <p className="font-medium text-sm leading-tight truncate">
                {item.product_name}
              </p>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {item.store_name}
              </p>
              <p className="text-xs text-primary font-medium mt-2">
                Ver tienda →
              </p>
            </div>
          </Link>
        ))}
      </HorizontalCarousel>
    </section>
  );
}
