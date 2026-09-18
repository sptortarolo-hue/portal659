"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

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
export function CategoryNav({ sections, isModa = false }: { sections: { name: string }[]; isModa?: boolean }) {
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number | null>(null);
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
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isModa ? "🔍 Buscar en el catálogo…" : "🔍 Buscar en la carta…"}
            className="h-9 flex-1 min-w-0 rounded-full border border-border bg-card px-4 text-sm outline-none focus:border-primary"
            aria-label={isModa ? "Buscar en el catálogo" : "Buscar en la carta"}
          />
          {matches !== null && (
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
              {matches === 0 ? "Sin resultados" : `${matches} ${matches === 1 ? "resultado" : "resultados"}`}
            </span>
          )}
        </div>
      )}
      <nav
        ref={navRef}
        className="sticky top-[152px] sm:top-16 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border flex gap-2 overflow-x-auto mb-6"
      >
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
    </>
  );
}
