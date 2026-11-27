"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** Slug estable para deep links ?cat= (sin tildes, solo [a-z0-9-]). */
export function categorySlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Nav sticky de categorías del menú con scroll spy: la pill de la sección
 * visible se pinta activa mientras se scrollea (y al hacer click scrollea a la
 * sección, dejándola bajo el nav). La pill activa se mantiene visible con un
 * scroll automático horizontal dentro del nav.
 *
 * Extras de la carta-QR: buscador de productos (filtra por data-pname del DOM
 * server-rendered, sin esperar nada del server) y deep link ?cat=<slug> que
 * scrollea directo a esa sección.
 */
export function CategoryNav({ sections, catalog = false }: { sections: { name: string }[]; catalog?: boolean }) {
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const params = useSearchParams();

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
    const nav = navRef.current;
    if (!nav) return;
    const pill = nav.querySelector<HTMLButtonElement>(`[data-index="${active}"]`);
    if (!pill) return;
    // Scroll horizontal SOLO del nav (sin tocar el scroll de la página, para
    // no cortar el smooth-scroll de ScrollToProduct de ?oferta=ID).
    const pr = pill.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const left = nav.scrollLeft + (pr.left - nr.left) - (nav.clientWidth - pr.width) / 2;
    nav.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  const updateScrollState = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    setCanScrollLeft(nav.scrollLeft > 4);
    setCanScrollRight(nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    updateScrollState();
    const onScroll = () => updateScrollState();
    nav.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateScrollState());
    ro.observe(nav);
    return () => {
      nav.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [updateScrollState, sections]);

  const goTo = useCallback((i: number) => {
    const el = document.getElementById(`seccion-${i}`);
    if (!el) return;
    const isMobile = window.innerWidth < 640;
    // 184 mobile: nav(104) + barra marca (48, cuando aparece) + pill row (~44),
    // queda la sección visible debajo de todo el bloque fijo.
    const offset = isMobile ? 184 : 96;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  const scrollNav = useCallback((dir: -1 | 1) => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollBy({ left: dir * nav.clientWidth * 0.8, behavior: "smooth" });
  }, []);

  // Deep link ?cat=<slug> → scrollea a esa sección (una vez, al montar).
  useEffect(() => {
    const cat = params.get("cat");
    if (!cat) return;
    const idx = sections.findIndex((s) => categorySlug(s.name) === cat);
    if (idx < 0) return;
    const id = window.setTimeout(() => goTo(idx), 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencional: solo al montar con el param inicial
  }, []);

  // Buscador de la carta: filtra productos por data-pname (marcado en page.tsx)
  // y oculta las secciones que quedan sin productos visibles.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-pname]"));
    if (!q) {
      rows.forEach((el) => (el.style.display = ""));
      document
        .querySelectorAll<HTMLElement>('section[id^="seccion-"]')
        .forEach((sec) => (sec.style.display = ""));
      setMatches(null);
      return;
    }
    let visible = 0;
    rows.forEach((el) => {
      const show = (el.dataset.pname || "").includes(q);
      el.style.display = show ? "" : "none";
      if (show) visible++;
    });
    document.querySelectorAll<HTMLElement>('section[id^="seccion-"]').forEach((sec) => {
      const kids = Array.from(sec.querySelectorAll<HTMLElement>("[data-pname]"));
      const anyVisible = kids.some((k) => k.style.display !== "none");
      sec.style.display = anyVisible ? "" : "none";
    });
    setMatches(visible);
  }, [query]);

  return (
    <>
      {sections.length > 1 && (
        <div className="-mt-2 mb-2 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pv2-icon-accent" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={catalog ? "Buscar en el catálogo…" : "Buscar en la carta…"}
              className="pv2-pill h-9 w-full min-w-0 pl-9 pr-4 text-sm outline-none"
              aria-label={catalog ? "Buscar en el catálogo" : "Buscar en la carta"}
            />
          </div>
          {matches !== null && (
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {matches === 0 ? "Sin resultados" : `${matches} ${matches === 1 ? "resultado" : "resultados"}`}
            </span>
          )}
        </div>
      )}
      <div className="relative sticky top-[152px] sm:top-16 z-30 -mx-4 px-4 py-2 bg-background border-b border-border mb-6">
        {canScrollLeft && (
          <button
            type="button"
            aria-label="Categorías anteriores"
            onClick={() => scrollNav(-1)}
            className="hidden sm:flex absolute left-1 top-1/2 -translate-y-1/2 z-40 h-7 w-7 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-md backdrop-blur-sm hover:bg-card transition text-base leading-none"
          >
            ‹
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            aria-label="Más categorías"
            onClick={() => scrollNav(1)}
            className="hidden sm:flex absolute right-1 top-1/2 -translate-y-1/2 z-40 h-7 w-7 items-center justify-center rounded-full border border-border bg-card/95 text-foreground shadow-md backdrop-blur-sm hover:bg-card transition text-base leading-none"
          >
            ›
          </button>
        )}
        {canScrollLeft && (
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-r from-background to-transparent"
          />
        )}
        {canScrollRight && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 z-20 bg-gradient-to-l from-background to-transparent"
          />
        )}
        <nav
          ref={navRef}
          className="flex gap-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory scroll-smooth"
        >
          {sections.map((s, i) => (
            <button
              key={s.name}
              type="button"
              data-index={i}
              onClick={() => goTo(i)}
              className={`pv2-pill snap-start shrink-0 whitespace-nowrap px-4 py-1.5 text-sm ${
                active === i ? "pv2-active" : ""
              }`}
            >
              {s.name}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
