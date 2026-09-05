"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Nav sticky de categorías del menú con scroll spy: la pill de la sección
 * visible se pinta activa mientras se scrollea (y al hacer click scrollea a la
 * sección, dejándola bajo el nav). La pill activa se mantiene visible con un
 * scroll automático horizontal dentro del nav.
 */
export function CategoryNav({ sections }: { sections: { name: string }[] }) {
  const [active, setActive] = useState(0);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const onIntersect = (index: number) => (entries: IntersectionObserverEntry[]) => {
      if (entries.some((e) => e.isIntersecting)) setActive(index);
    };

    sections.forEach((_s, i) => {
      const el = document.getElementById(`seccion-${i}`);
      if (!el) return;
      // Detecta cuándo la sección cruza el ~40% superior del viewport.
      const obs = new IntersectionObserver(onIntersect(i), {
        rootMargin: "-20% 0px -60% 0px",
        threshold: 0,
      });
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, [sections]);

  useEffect(() => {
    if (!navRef.current) return;
    const pill = navRef.current.querySelector<HTMLButtonElement>(`[data-index="${active}"]`);
    pill?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [active]);

  function goTo(i: number) {
    const el = document.getElementById(`seccion-${i}`);
    if (!el) return;
    const isMobile = window.innerWidth < 640;
    const offset = isMobile ? 136 : 96; // altura de nav + sticky pills
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <nav ref={navRef} className="sticky top-[104px] sm:top-16 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border flex gap-2 overflow-x-auto mb-6">
      {sections.map((s, i) => (
        <button
          key={s.name}
          type="button"
          data-index={i}
          onClick={() => goTo(i)}
          className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            active === i
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary"
          }`}
        >
          {s.name}
        </button>
      ))}
    </nav>
  );
}