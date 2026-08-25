"use client";

import { useRef } from "react";

type HorizontalCarouselProps = {
  children: React.ReactNode;
  className?: string;
};

export function HorizontalCarousel({ children, className = "" }: HorizontalCarouselProps) {
  const ref = useRef<HTMLDivElement>(null);

  function scroll(dir: "left" | "right") {
    if (!ref.current) return;
    const amount = ref.current.offsetWidth * 0.7;
    ref.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  }

  return (
    <div className={`relative group ${className}`}>
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-card/90 border border-border shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity -ml-3"
        aria-label="Anterior"
      >
        ‹
      </button>
      <div
        ref={ref}
        className="flex gap-4 overflow-x-auto scrollbar-none snap-x snap-mandatory scroll-smooth pb-2"
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full bg-card/90 border border-border shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity -mr-3"
        aria-label="Siguiente"
      >
        ›
      </button>
    </div>
  );
}
