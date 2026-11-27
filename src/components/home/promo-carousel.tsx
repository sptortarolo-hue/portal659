"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProductImage } from "@/components/product-image";

type PromoSlide = {
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  /** Foto del producto; si no hay, se usa la del comercio. */
  imageUrl?: string | null;
  name?: string;
  vertical?: string | null;
};

type PromoCarouselProps = {
  slides: PromoSlide[];
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Carrusel de promos del home v2: rotación automática pausable + cuenta regresiva local. */
export function PromoCarousel({ slides }: PromoCarouselProps) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || slides.length < 2) return;
    const id = setInterval(() => setActive((prev) => (prev + 1) % slides.length), 4000);
    return () => clearInterval(id);
  }, [paused, reducedMotion, slides.length]);

  if (slides.length === 0) return null;

  const current = now ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : null;
  const end = current ? new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1) : null;
  const remaining = now && end ? Math.max(0, end.getTime() - now.getTime()) : 0;
  const dayMs = current && end ? end.getTime() - current.getTime() : 0;
  const progress = current && now && dayMs > 0
    ? Math.min(100, Math.max(0, ((now.getTime() - current.getTime()) / dayMs) * 100))
    : 0;
  const slideTransition = reducedMotion ? "none" : "opacity .6s ease, transform .6s ease";

  return (
    <section
      aria-label="Promociones"
      className="pv2-card relative h-[190px] w-full overflow-hidden sm:h-[150px]"
      style={{
        background: "linear-gradient(135deg, #4f46e5 0%, #6d5df0 100%)",
        borderRadius: 20,
        borderColor: "transparent",
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {slides.map((slide, index) => {
        const isActive = index === active;
        return (
          <div
            key={`${slide.href}-${index}`}
            aria-hidden={!isActive}
            className="absolute inset-0 flex flex-col justify-center pl-5 pr-32 pb-12 sm:pl-7"
            style={{
              opacity: isActive ? 1 : 0,
              transform: isActive ? "translateX(0)" : "translateX(16px)",
              transition: slideTransition,
              pointerEvents: isActive ? "auto" : "none",
            }}
          >
            {slide.imageUrl && (
              <>
                <ProductImage
                  src={slide.imageUrl}
                  name={slide.name || slide.title}
                  vertical={slide.vertical ?? null}
                  alt={slide.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(49,46,129,.94) 0%, rgba(79,70,229,.76) 45%, rgba(79,70,229,.32) 100%)",
                  }}
                />
              </>
            )}
            <div className="relative z-10">
              <h3 className="pv2-title text-xl sm:text-2xl" style={{ color: "#ffffff" }}>
                {slide.title}
              </h3>
              <p className="mt-1 max-w-md text-xs text-indigo-100 sm:text-sm">{slide.subtitle}</p>
              <Link
                href={slide.href}
                tabIndex={isActive ? 0 : -1}
                className="pv2-btn pv2-btn-primary mt-3 w-fit px-4 py-2 text-xs sm:text-sm"
              >
                {slide.cta}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
          </div>
        );
      })}

      <div className="absolute bottom-4 left-5 z-20 flex items-center gap-1.5 sm:left-7" role="tablist" aria-label="Elegir promoción">
        {slides.map((slide, index) => (
          <button
            key={`dot-${slide.href}-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-label={`Promoción ${index + 1}: ${slide.title}`}
            onClick={() => setActive(index)}
            className="h-2 rounded-full border-0 p-0"
            style={{
              width: index === active ? 22 : 8,
              background: index === active ? "#a3e635" : "rgba(255, 255, 255, 0.55)",
              transition: reducedMotion ? "none" : "width .3s ease, background-color .3s ease",
            }}
          />
        ))}
      </div>

      <div
        className="absolute bottom-4 right-5 z-20 w-[112px] sm:right-7"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-wide text-indigo-100">
          Termina en <span className="text-sm font-bold text-white">{now ? formatRemaining(remaining) : "--:--:--"}</span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-lime-300"
            style={{
              width: `${progress}%`,
              transition: reducedMotion ? "none" : "width 1s linear",
            }}
          />
        </div>
      </div>
    </section>
  );
}
