"use client";

import { useMemo, useState } from "react";
import { VERTICALS } from "@/lib/config";
import { isStoreOpen } from "@/lib/open-hours";
import { VendorCard } from "@/components/store/vendor-card";

export type DiscoveryVendor = {
  id: string;
  slug: string | null;
  store_name: string;
  image_url: string | null;
  logo_url?: string | null;
  description: string | null;
  vertical: string | null;
  hours: string | null;
  open_override: boolean | null;
  acceptsCart: boolean | null;
  featured?: boolean;
};

type DiscoveryGridProps = {
  vendors: DiscoveryVendor[];
};

const VERTICAL_PREFIX = "vertical:";

/** Grilla de descubrimiento con filtros 100% en cliente (sin llamadas nuevas). */
export function DiscoveryGrid({ vendors }: DiscoveryGridProps) {
  const [filter, setFilter] = useState("all");

  const verticalChips = useMemo(() => {
    const present = new Set(
      vendors.map((v) => v.vertical).filter((slug): slug is string => Boolean(slug))
    );
    return VERTICALS.filter((vertical) => present.has(vertical.slug));
  }, [vendors]);

  const filtered = useMemo(() => {
    if (filter === "all") return vendors;
    if (filter === "featured") return vendors.filter((v) => v.featured === true);
    if (filter === "open") {
      return vendors.filter((v) => isStoreOpen({ hours: v.hours, open_override: v.open_override }) === true);
    }
    if (filter.startsWith(VERTICAL_PREFIX)) {
      const slug = filter.slice(VERTICAL_PREFIX.length);
      return vendors.filter((v) => v.vertical === slug);
    }
    return vendors;
  }, [vendors, filter]);

  const chips = [
    { key: "all", label: "Todos" },
    { key: "featured", label: "Destacados" },
    { key: "open", label: "Abiertos ahora" },
    ...verticalChips.map((vertical) => ({
      key: `${VERTICAL_PREFIX}${vertical.slug}`,
      label: vertical.name,
    })),
  ];

  return (
    <section aria-label="Comercios del barrio">
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filtrar comercios">
        {chips.map((chip) => {
          const isActive = filter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setFilter(chip.key)}
              className={`pv2-pill px-4 py-2 text-xs sm:text-sm ${isActive ? "pv2-active" : ""}`}
              style={{ transform: isActive ? "scale(1.04)" : "scale(1)" }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="pv2-card flex min-h-[180px] items-center justify-center px-6 py-10 text-center">
          <p className="pv2-subtitle">No hay comercios con este filtro</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filtered.map((vendor, index) => (
            <div
              key={vendor.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${index * 0.07}s` }}
            >
              <VendorCard
                id={vendor.id}
                slug={vendor.slug}
                store_name={vendor.store_name}
                image_url={vendor.image_url}
                logo_url={vendor.logo_url}
                description={vendor.description}
                vertical={vendor.vertical}
                hours={vendor.hours}
                open_override={vendor.open_override}
                acceptsCart={vendor.acceptsCart}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
