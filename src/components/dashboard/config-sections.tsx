"use client";

import { useEffect, useState, type ReactNode } from "react";

export type ConfigSectionDef = {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  /** Hijos declarados (prop de entrada). */
  children?: ReactNode;
  /** Contenido acumulado por el shell (merge de mismo id). */
  content?: ReactNode;
};

/**
 * Hijo declarativo de ConfigSections. No renderiza nada por sí mismo: el
 * shell agrupa por id y muestra el contenido de la sección activa.
 */
export function ConfigSection({ children }: ConfigSectionDef) {
  return <>{children}</>;
}

type Props = {
  storageKey: string;
  defaultId?: string;
  /** Eventos externos que abren una sección (ej. portal:open-printer-config). */
  openEvents?: Array<{ event: string; sectionId: string }>;
  children: ReactNode;
};

/**
 * Config por secciones (reemplaza la columna de desplegables):
 * - Desktop: sub-nav lateral fija + una sección visible.
 * - Mobile: chips horizontales + una sección visible.
 * Todo el contenido vive en el mismo <form> del dashboard: los botones de
 * la nav llevan type="button" para no disparar submit. La sección activa
 * persiste en localStorage. Sin dependencias con el guardado (saveVendor
 * sigue igual en cada dashboard).
 */
export function ConfigSections({ storageKey, defaultId, openEvents = [], children }: Props) {
  const defs: ConfigSectionDef[] = [];
  const walk = (nodes: ReactNode): void => {
    const arr = Array.isArray(nodes) ? nodes : [nodes];
    for (const n of arr) {
      if (n == null || typeof n === "boolean") continue;
      if (typeof n === "object" && n !== null && "props" in n) {
        const p = (n as { props: ConfigSectionDef }).props;
        if (p && typeof p.id === "string" && "children" in p) {
          const found = defs.find((d) => d.id === p.id);
          if (found) {
            // Mismo id = misma sección (contenidos no contiguos se acumulan).
            const prev = found.content;
            found.content = (
              <>
                {prev}
                {p.children}
              </>
            );
          } else {
            defs.push({ id: p.id, label: p.label, icon: p.icon, badge: p.badge, content: p.children });
          }
          continue;
        }
        // Contenedor sin id (fragment, div): se recorre por dentro.
        if (p && "children" in p) {
          walk((p as { children: ReactNode }).children);
          continue;
        }
      }
      // No se esperaba nada fuera de ConfigSection; se ignora.
    }
  };
  walk(children);

  const [activeId, setActiveId] = useState<string>(() => defaultId ?? defs[0]?.id ?? "");
  // Hidrata la sección persistida solo en cliente (evita mismatch de SSR).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && defs.some((d) => d.id === saved)) setActiveId(saved);
    } catch {
      /* sin storage: default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = defs.find((d) => d.id === activeId) ?? defs[0];

  const activate = (id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* noop */
    }
    const mapped = openEvents.find((o) => o.sectionId === id);
    if (mapped) window.dispatchEvent(new Event(mapped.event));
  };

  // Al montar, si la sección persistida tiene evento asociado (ej. la
  // impresora se abrió desde el header), se dispara para expandirla.
  useEffect(() => {
    const mapped = openEvents.find((o) => o.sectionId === activeId);
    if (mapped) {
      const t = window.setTimeout(() => window.dispatchEvent(new Event(mapped.event)), 100);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Eventos externos (el header del dashboard los dispara).
  useEffect(() => {
    const handlers = openEvents.map(({ event, sectionId }) => {
      const h = () => activate(sectionId);
      window.addEventListener(event, h);
      return { event, h };
    });
    return () => handlers.forEach(({ event, h }) => window.removeEventListener(event, h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEvents.length]);

  if (!active) return null;

  return (
    <div>
      {/* Mobile: chips horizontales (1 tap, todo visible). */}
      <div className="md:hidden flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide -mx-1 px-1">
        {defs.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => activate(d.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
              d.id === active.id
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <span>{d.icon}</span>
            {d.label}
            {d.badge && (
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                  d.id === active.id ? "bg-primary-foreground/20" : "bg-foreground/10"
                }`}
              >
                {d.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="md:flex md:gap-5 md:items-start">
        {/* Desktop: sub-nav lateral fija. */}
        <nav className="hidden md:flex flex-col w-56 shrink-0 gap-1 sticky top-24">
          {defs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => activate(d.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                d.id === active.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className="text-base w-6 text-center flex-shrink-0">{d.icon}</span>
              <span className="flex-1">{d.label}</span>
              {d.badge && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">
                  {d.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Contenido de la sección activa. */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xl">{active.icon}</span>
            <h3 className="font-display text-base font-semibold">{active.label}</h3>
            {active.badge && (
              <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">
                {active.badge}
              </span>
            )}
          </div>
          <div className="space-y-3">{active.content}</div>
        </div>
      </div>
    </div>
  );
}
