"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Vendor } from "@/types/database";

const MaplibreMap = dynamic(() => import("./maplibre-map").then((m) => m.MaplibreMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Cargando mapa...</span>
    </div>
  ),
});

type VerticalInfo = {
  slug: string;
  name: string;
  emoji: string;
  hex: string;
};

type Props = {
  vendors: Vendor[];
  verticals: VerticalInfo[];
};

const CENTER = [-34.9881, -57.8561] as [number, number];

// Deja visible el encuadre entre la barra de filtros y la hoja/lista. El top
// suma la altura del pin (32px) para que no quede tapado por la barra.
const FIT_PADDING = { top: 176, right: 40, bottom: 120, left: 40 };

function hasRealCoords(v: Vendor): boolean {
  return (
    typeof v.lat === "number" &&
    typeof v.lng === "number" &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng)
  );
}

function getVertical(v: string, verticals: VerticalInfo[]): VerticalInfo | undefined {
  return verticals.find((x) => x.slug === v);
}

function getVerticalColor(vertical: string, verticals: VerticalInfo[]): string {
  return getVertical(vertical, verticals)?.hex || "#6B7280";
}

function getVerticalEmoji(vertical: string, verticals: VerticalInfo[]): string {
  return getVertical(vertical, verticals)?.emoji || "•";
}

function getVerticalName(vertical: string, verticals: VerticalInfo[]): string {
  return getVertical(vertical, verticals)?.name || vertical;
}

function toggleClass(active: boolean): string {
  return active
    ? "border-transparent text-white"
    : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary";
}

function CategoryChips({
  stats,
  filter,
  onToggle,
  wrap,
}: {
  stats: (VerticalInfo & { count: number })[];
  filter: string | null;
  onToggle: (slug: string | null) => void;
  wrap?: boolean;
}) {
  return (
    <div
      className={
        wrap
          ? "flex flex-wrap gap-1.5"
          : "flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      }
    >
      <button
        type="button"
        onClick={() => onToggle(null)}
        className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
          !filter
            ? "bg-primary text-white border-primary"
            : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
        }`}
      >
        Todos
      </button>
      {stats.map((v) => {
        const active = filter === v.slug;
        return (
          <button
            key={v.slug}
            type="button"
            onClick={() => onToggle(active ? null : v.slug)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${toggleClass(
              active
            )}`}
            style={active ? { background: v.hex } : undefined}
          >
            <span>{v.emoji}</span>
            {v.name}
            {v.count > 0 && (
              <span
                className={`ml-0.5 text-[9px] px-1 rounded-full ${
                  active ? "bg-white/20" : "bg-muted"
                }`}
              >
                {v.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function NeighborhoodChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (neighborhood: string | null) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {["sicardi", "garibaldi"].map((nbh) => {
        const active = value === nbh;
        return (
          <button
            key={nbh}
            type="button"
            onClick={() => onChange(active ? null : nbh)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors capitalize ${
              active
                ? "bg-primary text-white border-primary"
                : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {nbh}
          </button>
        );
      })}
    </div>
  );
}

function VendorList({
  vendors,
  verticals,
  onSelect,
}: {
  vendors: Vendor[];
  verticals: VerticalInfo[];
  /** Si existe, la fila enfoca el mapa en vez de navegar a la tienda. */
  onSelect?: (vendorId: string) => void;
}) {
  if (vendors.length === 0) {
    return (
      <p className="text-center text-muted-foreground text-xs py-4">
        No hay comercios con estos filtros
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {vendors.map((v) => {
        const approximate = !hasRealCoords(v);
        const content = (
          <>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm flex-shrink-0"
              style={{ background: getVerticalColor(v.vertical, verticals) }}
            >
              {getVerticalEmoji(v.vertical, verticals)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                {v.store_name}
              </div>
              <div className="text-[10px] text-muted-foreground capitalize truncate">
                {v.neighborhood} · {getVerticalName(v.vertical, verticals)}
                {approximate && <span className="normal-case"> · ubicación aprox.</span>}
              </div>
            </div>
            {v.verified && <span className="text-[10px] text-primary font-bold">✓</span>}
          </>
        );

        return (
          <li key={v.id}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(v.id)}
                className="group w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted transition-colors text-left"
              >
                {content}
              </button>
            ) : (
              <Link
                href={`/tienda/${v.slug}`}
                className="group flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted transition-colors"
              >
                {content}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Legend({
  verticals,
  showApproximate,
}: {
  verticals: VerticalInfo[];
  showApproximate: boolean;
}) {
  return (
    <div className="mt-4 pt-3 border-t border-border">
      <h3 className="text-xs font-bold mb-2 text-muted-foreground">Leyenda</h3>
      <div className="space-y-1">
        {verticals.map((v) => (
          <div key={v.slug} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: v.hex }}
            />
            {v.emoji} {v.name}
          </div>
        ))}
        {showApproximate && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-dashed border-muted-foreground/70 bg-muted" />
            Ubicación aproximada
          </div>
        )}
      </div>
    </div>
  );
}

export function MapPageClient({ vendors, verticals }: Props) {
  const [filter, setFilter] = useState<string | null>(null);
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [focusVendorId, setFocusVendorId] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  const filtered = useMemo(
    () =>
      vendors.filter((v) => {
        if (filter && v.vertical !== filter) return false;
        if (neighborhoodFilter && v.neighborhood !== neighborhoodFilter) return false;
        return true;
      }),
    [vendors, filter, neighborhoodFilter]
  );

  const stats = useMemo(
    () => ({
      total: vendors.length,
      byVertical: verticals.map((vert) => ({
        ...vert,
        count: vendors.filter((v) => v.vertical === vert.slug).length,
      })),
    }),
    [vendors, verticals]
  );

  const hasApproximate = useMemo(() => vendors.some((v) => !hasRealCoords(v)), [vendors]);

  const toggleFilter = useCallback((slug: string | null) => {
    setFilter(slug);
    setFocusVendorId(null);
  }, []);
  const changeNeighborhood = useCallback((nbh: string | null) => {
    setNeighborhoodFilter(nbh);
    setFocusVendorId(null);
  }, []);

  const selectVendor = useCallback((vendorId: string) => {
    setSheetExpanded(false);
    setFocusVendorId(vendorId);
  }, []);

  const recenter = useCallback(() => setFitNonce((n) => n + 1), []);

  // Drag del handle de la hoja: tap alterna, arrastre corto decide según
  // el sentido. Solo el handle captura el gesto (la lista scrollea aparte).
  const dragStart = useRef<{ y: number; expanded: boolean } | null>(null);
  const suppressClick = useRef(false);

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    dragStart.current = {
      y: e.touches[0]?.clientY ?? 0,
      expanded: sheetExpanded,
    };
    suppressClick.current = false;
  };

  const handleSheetTouchEnd = (e: React.TouchEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    const dy = (e.changedTouches[0]?.clientY ?? start.y) - start.y;
    if (Math.abs(dy) < 28) return;
    suppressClick.current = true;
    setSheetExpanded(dy < 0);
  };

  const handleSheetClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSheetExpanded((open) => !open);
  };

  const catStats = stats.byVertical;

  return (
    <div className="mapa-page -mb-28 lg:container lg:mx-auto lg:mb-0 lg:px-4 lg:py-6">
      {/* Hero (solo desktop) */}
      <div className="hidden lg:block text-center mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Mapa de Comercios</h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">
          Parque Sicardi y Garibaldi — Explorá los negocios de tu barrio
        </p>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-4">
        {/* Mapa + overlays mobile */}
        <div className="relative overflow-hidden bg-background h-[calc(100dvh_-_9.5rem_-_env(safe-area-inset-bottom,0px))] min-h-[360px] sm:h-[calc(100dvh_-_4.0625rem)] sm:min-h-0 lg:h-auto lg:rounded-xl lg:border lg:border-border lg:shadow-md">
          <div className="absolute inset-0 lg:static lg:h-[600px]">
            <MaplibreMap
              center={CENTER}
              zoom={15}
              vendors={filtered}
              verticals={verticals}
              fitPadding={FIT_PADDING}
              fitNonce={fitNonce}
              focusVendorId={focusVendorId}
              className="h-full w-full"
            />
          </div>

          {/* Barra flotante de filtros (mobile) */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 lg:hidden">
            <div className="p-2">
              <div className="pointer-events-auto rounded-xl border border-border bg-card/95 px-3 py-2 shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="text-sm font-bold leading-tight text-foreground">
                      Mapa de comercios
                    </h1>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      Sicardi y Garibaldi · {filtered.length}{" "}
                      {filtered.length === 1 ? "comercio" : "comercios"} ·{" "}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-foreground"
                      >
                        © OpenStreetMap
                      </a>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={recenter}
                    aria-label="Centrar el mapa en todos los comercios"
                    className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    Centrar
                  </button>
                </div>
                <div className="mt-2 -mx-1 px-1 pb-0.5">
                  <CategoryChips
                    stats={catStats}
                    filter={filter}
                    onToggle={toggleFilter}
                  />
                </div>
                <div className="mt-1.5">
                  <NeighborhoodChips value={neighborhoodFilter} onChange={changeNeighborhood} />
                </div>
              </div>
            </div>
          </div>

          {/* Hoja con la lista (mobile) */}
          <section
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-border bg-card shadow-[0_-10px_30px_rgba(0,0,0,0.15)] transition-transform duration-300 ease-out will-change-transform lg:hidden"
            style={{
              // Al expandirse no tapa la barra de filtros (deja un respiro).
              height: "min(72dvh, 36rem, calc(100% - 9rem))",
              transform: sheetExpanded ? "translateY(0)" : "translateY(calc(100% - 5.5rem))",
            }}
            aria-label="Lista de comercios"
          >
            <button
              type="button"
              onClick={handleSheetClick}
              onTouchStart={handleSheetTouchStart}
              onTouchEnd={handleSheetTouchEnd}
              aria-expanded={sheetExpanded}
              aria-controls="mapa-sheet-body"
              className="w-full shrink-0 select-none px-4 pb-2.5 pt-2 text-left"
              style={{ touchAction: "none" }}
            >
              <span className="mx-auto block h-1 w-10 rounded-full bg-muted-foreground/30" />
              <span className="mt-2 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-foreground">
                  Comercios ({filtered.length})
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {sheetExpanded ? "Ocultar lista" : "Ver lista"}
                </span>
              </span>
            </button>
            <div
              id="mapa-sheet-body"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom,0px)_+_1rem)]"
            >
              <VendorList vendors={filtered} verticals={verticals} onSelect={selectVendor} />
              <Legend verticals={verticals} showApproximate={hasApproximate} />
            </div>
          </section>
        </div>

        {/* Sidebar (desktop) */}
        <aside className="hidden lg:block bg-card border border-border rounded-xl p-4 max-h-[600px] overflow-y-auto">
          <h2 className="font-bold text-sm mb-3">Comercios ({filtered.length})</h2>

          <div className="grid grid-cols-2 gap-2 mb-4">
            <div className="bg-background border border-border rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-primary">{stats.total}</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total</div>
            </div>
            <div className="bg-background border border-border rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-primary">2</div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Barrios</div>
            </div>
          </div>

          <div className="mb-3">
            <h3 className="text-xs font-bold mb-2 text-muted-foreground">Categorías</h3>
            <CategoryChips stats={catStats} filter={filter} onToggle={toggleFilter} wrap />
          </div>

          <div className="mb-3">
            <h3 className="text-xs font-bold mb-2 text-muted-foreground">Barrios</h3>
            <NeighborhoodChips value={neighborhoodFilter} onChange={changeNeighborhood} />
          </div>

          <h3 className="text-xs font-bold mb-2 text-muted-foreground">Vendedores</h3>
          <VendorList vendors={filtered} verticals={verticals} />
          <Legend verticals={verticals} showApproximate={hasApproximate} />
        </aside>
      </div>
    </div>
  );
}
