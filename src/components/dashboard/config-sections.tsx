"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Vista mobile (<md, 768px): el drill-down usa esta media para decidir si pushea historial. */
function isMobileView(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
  } catch {
    return false;
  }
}
import { Button } from "@/components/ui/button";
import {
  CONFIG_SECTION_DESCS,
  CONFIG_SECTION_GROUPS,
  configSectionIcon,
} from "@/components/dashboard/config-nav";

export type ConfigSectionDef = {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  /** Estado operativo (dot en la nav). Lo calcula el dashboard con vendor. */
  status?: "ok" | "warn" | "off";
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

/**
 * Barra de guardado dockeada (estilo save bar contextual): reemplaza al
 * botón de guardar perdido al final del form. Vive dentro del <form>:
 * Guardar hace submit, Descartar recarga el vendor (los campos vuelven
 * solos por el efecto de sync de cada dashboard).
 */
export function ConfigSaveBar({
  saving,
  onDiscard,
}: {
  saving: boolean;
  onDiscard: () => void;
}) {
  return (
    <div className="sticky bottom-[4.75rem] md:bottom-6 z-30 mt-2">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-lg">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onDiscard}
          disabled={saving}
        >
          Descartar
        </Button>
        <Button type="submit" className="flex-1" disabled={saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </div>
    </div>
  );
}

type Props = {
  storageKey: string;
  defaultId?: string;
  /** Eventos externos que abren una sección (ej. portal:open-printer-config). */
  openEvents?: Array<{ event: string; sectionId: string }>;
  /** Modo controlado (lo maneja dashboard/page para la sidebar única). */
  activeId?: string;
  onActiveChange?: (id: string) => void;
  children: ReactNode;
};

function SectionIcon({ id, fallback, className }: { id: string; fallback: string; className?: string }) {
  const Icon = configSectionIcon(id);
  return <Icon className={className} aria-hidden />;
}

export function StatusDot({ status }: { status: "ok" | "warn" | "off" }) {
  const color =
    status === "ok" ? "bg-green-500" : status === "warn" ? "bg-amber-500" : "bg-muted-foreground/40";
  const title = status === "ok" ? "Configurado" : status === "warn" ? "Incompleto" : "Sin configurar";
  return <span title={title} className={`h-2 w-2 rounded-full flex-shrink-0 ${color}`} />;
}

/**
 * Config por secciones (reemplaza la columna de desplegables):
 * - Desktop: sub-nav lateral agrupada + una sección visible.
 * - Mobile: lista drill-down estilo Ajustes (menú ↔ detalle con atrás).
 * Todo el contenido vive en el mismo <form> del dashboard: los botones de
 * la nav llevan type="button" para no disparar submit. La sección activa
 * persiste en localStorage. Sin dependencias con el guardado (saveVendor
 * sigue igual en cada dashboard).
 */
export function ConfigSections({
  storageKey,
  defaultId,
  openEvents = [],
  activeId: controlledId,
  onActiveChange,
  children,
}: Props) {
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
            if (!found.badge && p.badge) found.badge = p.badge;
            if (!found.status && p.status) found.status = p.status;
          } else {
            defs.push({
              id: p.id,
              label: p.label,
              icon: p.icon,
              badge: p.badge,
              status: p.status,
              content: p.children,
            });
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

  const grouped = CONFIG_SECTION_GROUPS.map((g) => ({
    ...g,
    items: defs.filter((d) => g.sections.includes(d.id)),
  })).filter((g) => g.items.length > 0);
  const ungrouped = defs.filter((d) => !CONFIG_SECTION_GROUPS.some((g) => g.sections.includes(d.id)));

  const [innerId, setInnerId] = useState<string>(() => defaultId ?? defs[0]?.id ?? "");
  // Modo controlado (sidebar única de dashboard/page) o interno.
  const activeId = controlledId ?? innerId;
  const [mobileOpen, setMobileOpen] = useState(false);
  // Hidrata la sección persistida solo en cliente (evita mismatch de SSR).
  // En modo controlado lo maneja el padre (dashboard/page).
  useEffect(() => {
    if (controlledId !== undefined) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && defs.some((d) => d.id === saved)) setInnerId(saved);
    } catch {
      /* sin storage: default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = defs.find((d) => d.id === activeId) ?? defs[0];

  // Refs para el listener de popstate (evita closures rancias).
  const defsRef = useRef(defs);
  defsRef.current = defs;
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  /**
   * Sincroniza el detalle mobile con el historial del browser: cada apertura
   * pushea `?seccion=<id>` para que el botón atrás del celu vuelva al menú
   * (o al detalle anterior) en vez de sacar al usuario de la página.
   */
  const pushCfgState = (id: string, replace = false) => {
    if (!isMobileView()) return;
    try {
      const st = window.history.state as { cfg?: string } | null;
      if (!replace && st && st.cfg === id) return; // ya es la entrada actual
      const url = new URL(window.location.href);
      url.searchParams.set("seccion", id);
      if (replace) window.history.replaceState({ cfg: id }, "", url.toString());
      else window.history.pushState({ cfg: id }, "", url.toString());
    } catch {
      /* noop */
    }
  };

  const activate = (id: string, openMobile = true, replace = false) => {
    if (onActiveChange) onActiveChange(id);
    else setInnerId(id);
    if (openMobile) {
      setMobileOpen(true);
      pushCfgState(id, replace);
    }
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* noop */
    }
    const mapped = openEvents.find((o) => o.sectionId === id);
    if (mapped) window.dispatchEvent(new Event(mapped.event));
  };

  /** Cierre del detalle mobile: vuelve por historial si la entrada es nuestra. */
  const closeMobile = () => {
    try {
      const st = window.history.state as { cfg?: string } | null;
      if (st && st.cfg) {
        window.history.back();
        return;
      }
    } catch {
      /* noop */
    }
    setMobileOpen(false);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has("seccion")) {
        url.searchParams.delete("seccion");
        window.history.replaceState(window.history.state, "", url.toString());
      }
    } catch {
      /* noop */
    }
  };

  // Botón atrás del sistema (Android/iOS): vuelve al menú o al detalle
  // anterior de la pila en vez de salir de la página.
  useEffect(() => {
    const onPop = () => {
      let cfg: string | undefined;
      try {
        cfg = (window.history.state as { cfg?: string } | null)?.cfg;
      } catch {
        cfg = undefined;
      }
      if (cfg && defsRef.current.some((d) => d.id === cfg)) {
        if (onActiveChangeRef.current) onActiveChangeRef.current(cfg);
        else setInnerId(cfg);
        setMobileOpen(true);
      } else {
        setMobileOpen(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setInnerId]);

  // En modo controlado, si el padre cambia la sección (sidebar/drawer en
  // mobile), se abre el detalle para no dejar al usuario en el menú.
  const lastActiveRef = useRef(activeId);
  useEffect(() => {
    if (controlledId === undefined) return;
    if (lastActiveRef.current === activeId) return;
    lastActiveRef.current = activeId;
    if (isMobileView()) {
      setMobileOpen(true);
      pushCfgState(activeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, controlledId]);

  // Al montar: deep-link ?seccion=<id> (replace para no ensuciar el
  // historial: atrás desde un link directo sale de la página, es natural).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("seccion");
      if (q && defs.some((d) => d.id === q)) activate(q, true, true);
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const desc = CONFIG_SECTION_DESCS[active.id];

  return (
    <div>
      {/* Mobile: lista drill-down (menú ↔ detalle). */}
      <div className="md:hidden">
        {!mobileOpen ? (
          <div className="space-y-4">
            {grouped.map((g) => (
              <div key={g.id}>
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
                  {g.label}
                </p>
                <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
                  {g.items.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => activate(d.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 min-h-[52px] text-left active:bg-muted transition-colors"
                    >
                      <SectionIcon id={d.id} fallback={d.icon} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{d.label}</span>
                        {CONFIG_SECTION_DESCS[d.id] && (
                          <span className="block text-xs text-muted-foreground truncate">
                            {CONFIG_SECTION_DESCS[d.id]}
                          </span>
                        )}
                      </span>
                      {d.badge && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">
                          {d.badge}
                        </span>
                      )}
                      {d.status && <StatusDot status={d.status} />}
                      <span className="text-muted-foreground flex-shrink-0">›</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
                {ungrouped.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => activate(d.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-muted transition-colors"
                  >
                    <SectionIcon id={d.id} fallback={d.icon} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{d.label}</span>
                      {CONFIG_SECTION_DESCS[d.id] && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {CONFIG_SECTION_DESCS[d.id]}
                        </span>
                      )}
                    </span>
                    {d.status && <StatusDot status={d.status} />}
                    <span className="text-muted-foreground flex-shrink-0">›</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={closeMobile}
              className="flex items-center gap-1 text-xs font-bold text-primary mb-2 py-1"
            >
              <span aria-hidden>‹</span> Configuración
            </button>
            <div className="flex items-center gap-2 mb-1">
              <SectionIcon id={active.id} fallback={active.icon} className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-display text-base font-semibold">{active.label}</h3>
              {active.status && <StatusDot status={active.status} />}
            </div>
            {desc && <p className="text-xs text-muted-foreground mb-3">{desc}</p>}
            <div className="space-y-3">{active.content}</div>
          </div>
        )}
      </div>

      {/* Desktop: contenido a ancho completo (la nav vive en la sidebar única). */}
      <div className="hidden md:block">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="font-display text-base font-semibold">{active.label}</h3>
          {active.status && <StatusDot status={active.status} />}
        </div>
        {desc && <p className="text-xs text-muted-foreground mb-3">{desc}</p>}
        <div className="space-y-3">{active.content}</div>
      </div>
    </div>
  );
}
