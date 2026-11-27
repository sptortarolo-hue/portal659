"use client";

import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { isStoreOpen } from "@/lib/open-hours";
import { SectionHeading } from "@/components/home/section-heading";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { VendorCard } from "@/components/store/vendor-card";
import type { Vendor } from "@/types/database";

/**
 * Carrusel de comercios abiertos AHORA. El filtrado se hace en el cliente
 * (el servidor puede estar en otra zona horaria que el usuario).
 * Si no hay comercios abiertos, no renderiza nada.
 */
export function OpenNowSection({ vendors, onlineByVendor }: { vendors: Vendor[]; onlineByVendor?: Record<string, boolean> }) {
  const [open, setOpen] = useState<Vendor[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOpen(vendors.filter((v) => isStoreOpen(v) === true));
    setReady(true);
  }, [vendors]);

  // El punto "live" se renderiza acá (no en SectionHeading) para poder darle
  // la clase pv2-live-dot sin tocar el componente compartido.
  const heading = (
    <div className="flex items-center transition-all duration-300">
      <span className="pv2-live-dot relative mr-1 flex h-2.5 w-2.5 flex-shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--pv2-accent)] opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--pv2-accent)]" />
      </span>
      <SectionHeading icon={Store} title="Abiertos ahora" description="Pedíles en este momento" />
    </div>
  );

  if (!ready) {
    return (
      <section className="container mx-auto px-4 pb-10 sm:pb-12" id="abiertos" aria-busy="true">
        {heading}
        <HorizontalCarousel>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="min-w-[220px] max-w-[260px] snap-start">
              <div className="pv2-card h-full p-4">
                <div className="pv2-skeleton h-28 w-full" />
                <div className="pv2-skeleton mt-3 h-4 w-4/5" />
                <div className="pv2-skeleton mt-2 h-3 w-3/5" />
              </div>
            </div>
          ))}
        </HorizontalCarousel>
      </section>
    );
  }

  if (open.length === 0) return null;

  return (
    <section className="container mx-auto px-4 pb-10 sm:pb-12" id="abiertos">
      {heading}
      <HorizontalCarousel>
        {open.map((v) => (
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
            acceptsCart={onlineByVendor?.[v.id] ?? null}
          />
        ))}
      </HorizontalCarousel>
    </section>
  );
}
