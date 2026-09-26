"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  CreditCard,
  MapPin,
  Phone,
  Printer,
  Receipt,
  ShoppingBag,
  Store,
  Users,
  Settings2,
  type LucideIcon,
} from "lucide-react";

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
  children: ReactNode;
};

const SECTION_ICONS: Record<string, LucideIcon> = {
  perfil: Store,
  ubicacion: MapPin,
  contacto: Phone,
  pagos: CreditCard,
  equipo: Users,
  impresora: Printer,
  fiscal: Receipt,
  menu: BookOpen,
  catalogo: ShoppingBag,
};

const SECTION_DESCS: Record<string, string> = {
  perfil: "Nombre, descripción, fotos y galería de tu vidriera.",
  ubicacion: "Dónde estás y cuándo abrís.",
  contacto: "Cómo te contactan tus clientes.",
  pagos: "Medios de pago, entrega, Mercado Pago y venta online.",
  equipo: "Tiempos, personal y reparto.",
  impresora: "Tickets y comandas en papel.",
  fiscal: "Factura electrónica ARCA.",
  menu: "Acceso rápido a tu carta.",
  catalogo: "Categorías y modificadores.",
};

const SECTION_GROUPS: Array<{ id: string; label: string; sections: string[] }> = [
  { id: "negocio", label: "Local", sections: ["perfil", "ubicacion", "contacto"] },
  { id: "ventas", label: "Ventas", sections: ["pagos", "menu", "catalogo"] },
  { id: "operacion", label: "Operación", sections: ["equipo", "impresora", "fiscal"] },
];

function SectionIcon({ id, fallback, className }: { id: string; fallback: string; className?: string }) {
  const Icon = SECTION_ICONS[id];
  if (!Icon) return <span className={className}>{fallback}</span>;
  return <Icon className={className} aria-hidden />;
}

function StatusDot({ status }: { status: "ok" | "warn" | "off" }) {
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

  const grouped = SECTION_GROUPS.map((g) => ({
    ...g,
    items: defs.filter((d) => g.sections.includes(d.id)),
  })).filter((g) => g.items.length > 0);
  const ungrouped = defs.filter((d) => !SECTION_GROUPS.some((g) => g.sections.includes(d.id)));

  const [activeId, setActiveId] = useState<string>(() => defaultId ?? defs[0]?.id ?? "");
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const activate = (id: string, openMobile = true) => {
    setActiveId(id);
    if (openMobile) setMobileOpen(true);
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

  const desc = SECTION_DESCS[active.id];

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
                      className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-muted transition-colors"
                    >
                      <SectionIcon id={d.id} fallback={d.icon} className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{d.label}</span>
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
                    <span className="flex-1 text-sm font-medium">{d.label}</span>
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
              onClick={() => setMobileOpen(false)}
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

      {/* Desktop: sub-nav lateral agrupada + contenido. */}
      <div className="hidden md:flex md:gap-5 md:items-start">
        <nav className="flex flex-col w-60 shrink-0 gap-4 sticky top-24">
          {grouped.map((g) => (
            <div key={g.id}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-3 mb-1">
                {g.label}
              </p>
              <div className="flex flex-col gap-0.5">
                {g.items.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => activate(d.id, false)}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                      d.id === active.id
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <SectionIcon id={d.id} fallback={d.icon} className="h-[18px] w-[18px] flex-shrink-0" />
                    <span className="flex-1">{d.label}</span>
                    {d.badge && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-bold">
                        {d.badge}
                      </span>
                    )}
                    {d.status && <StatusDot status={d.status} />}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {ungrouped.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {ungrouped.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => activate(d.id, false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                    d.id === active.id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <SectionIcon id={d.id} fallback={d.icon} className="h-[18px] w-[18px] flex-shrink-0" />
                  <span className="flex-1">{d.label}</span>
                  {d.status && <StatusDot status={d.status} />}
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-display text-base font-semibold">{active.label}</h3>
            {active.status && <StatusDot status={active.status} />}
          </div>
          {desc && <p className="text-xs text-muted-foreground mb-3">{desc}</p>}
          <div className="space-y-3">{active.content}</div>
        </div>
      </div>
    </div>
  );
}
