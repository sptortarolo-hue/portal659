"use client";

import { useEffect, useState } from "react";
import { isStoreOpen } from "@/lib/open-hours";
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

  if (!ready || open.length === 0) return null;

  return (
    <section className="container mx-auto px-4 pb-6" id="abiertos">
      <div className="flex items-center gap-3 mb-4">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-60" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold">Abiertos ahora</h2>
          <p className="text-xs text-muted-foreground">Pedíles en este momento</p>
        </div>
      </div>
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
