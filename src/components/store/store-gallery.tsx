"use client";

import { useCallback, useEffect, useState } from "react";
import { HorizontalCarousel } from "@/components/ui/horizontal-carousel";
import { ProductImage } from "@/components/product-image";

export type StoreGalleryItem = {
  id: string;
  image_url: string;
  caption?: string | null;
};

/**
 * Galería de la vidriera: carrusel con epígrafe visible + lightbox al
 * clickear (foto grande, epígrafe, anterior/siguiente, Escape y botón atrás).
 */
export function StoreGallery({ items, title }: { items: StoreGalleryItem[]; title: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const isOpen = openIdx !== null;

  // Cerrar volviendo en el historial: el popstate cierra la vista y no queda
  // entrada fantasma (un solo "atrás" vuelve a la vidriera como estaba).
  const close = useCallback(() => {
    const st = window.history.state as { portal659Gallery?: boolean } | null;
    if (st?.portal659Gallery) history.back();
    else setOpenIdx(null);
  }, []);

  // Escape cierra.
  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") setOpenIdx((i) => (i === null ? i : (i - 1 + items.length) % items.length));
      if (e.key === "ArrowRight") setOpenIdx((i) => (i === null ? i : (i + 1) % items.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, items.length, close]);

  // Botón atrás del celu cierra la vista y vuelve a la página como estaba
  // antes de clickear (el pushState hace que "atrás" sea "cerrar").
  // Sin replaceState en cleanup: cerrar es history.back() y el popstate cierra.
  useEffect(() => {
    if (!isOpen) return;
    const onPop = () => setOpenIdx(null);
    window.addEventListener("popstate", onPop);
    history.pushState({ portal659Gallery: true }, "", window.location.href);
    return () => window.removeEventListener("popstate", onPop);
  }, [isOpen]);

  if (!items || items.length === 0) return null;
  const open = openIdx !== null ? items[openIdx] : null;

  return (
    <div className="border border-border rounded-2xl p-4 sm:p-6 bg-card mt-6">
      <h2 className="font-display text-xl font-semibold mb-4">{title}</h2>
      <HorizontalCarousel>
        {items.map((g, i) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setOpenIdx(i)}
            className="flex-shrink-0 h-56 sm:h-64 aspect-[9/16] snap-start text-left active:scale-[0.99] transition-transform"
            aria-label={`Ampliar foto${g.caption ? `: ${g.caption}` : ""}`}
          >
            <div className="relative h-full w-full rounded-xl overflow-hidden bg-accent">
              <ProductImage
                src={g.image_url}
                name={g.caption || "Foto"}
                alt={g.caption || "Foto de la vidriera"}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center" aria-hidden="true">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16zm1-11v6m-3-3h6" />
                </svg>
              </span>
            </div>
            {g.caption && (
              <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{g.caption}</p>
            )}
          </button>
        ))}
      </HorizontalCarousel>

      {open && (
        <div
          className="fixed inset-0 z-[80] bg-black/85 flex flex-col"
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-label={open.caption || "Foto ampliada"}
        >
          <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-white">
            <span className="text-sm font-medium tabular-nums">
              {(openIdx ?? 0) + 1} / {items.length}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Cerrar"
              className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center text-xl"
            >
              ✕
            </button>
          </div>
          <div
            className="flex-1 min-h-0 min-w-0 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Marco 9:16 responsive: alto manda (70vh), ancho = 9/16, con tope */}
            <div className="relative h-[70vh] aspect-[9/16] max-w-full rounded-lg overflow-hidden bg-black">
              <ProductImage
                src={open.image_url}
                name={open.caption || "Foto"}
                alt={open.caption || "Foto de la vidriera"}
                className="w-full h-full object-cover"
              />
              {items.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Anterior"
                    onClick={() => setOpenIdx((i) => (i === null ? i : (i - 1 + items.length) % items.length))}
                    className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-black/60 text-white text-2xl flex items-center justify-center"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="Siguiente"
                    onClick={() => setOpenIdx((i) => (i === null ? i : (i + 1) % items.length))}
                    className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-black/60 text-white text-2xl flex items-center justify-center"
                  >
                    ›
                  </button>
                </>
              )}
            </div>
          </div>
          {open.caption && (
            <p className="text-center text-white text-sm px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
              {open.caption}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
