"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Vendor } from "@/types/database";

const MaplibreMap = dynamic(() => import("./maplibre-map").then((m) => m.MaplibreMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[500px] rounded-xl bg-muted animate-pulse flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Cargando mapa 3D...</span>
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
  vendorsWithCoords: Vendor[];
  verticals: VerticalInfo[];
};

const CENTER = [-34.9881, -57.8561] as [number, number];

function getVerticalColor(vertical: string, verticals: VerticalInfo[]): string {
  return verticals.find((v) => v.slug === vertical)?.hex || "#6B7280";
}

function getVerticalEmoji(vertical: string, verticals: VerticalInfo[]): string {
  return verticals.find((v) => v.slug === vertical)?.emoji || "📍";
}

function getVerticalName(vertical: string, verticals: VerticalInfo[]): string {
  return verticals.find((v) => v.slug === vertical)?.name || vertical;
}

export function MapPageClient({ vendors, vendorsWithCoords, verticals }: Props) {
  const [filter, setFilter] = useState<string | null>(null);
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string | null>(null);

  const filtered = vendors.filter((v) => {
    if (filter && v.vertical !== filter) return false;
    if (neighborhoodFilter && v.neighborhood !== neighborhoodFilter) return false;
    return true;
  });

  const stats = {
    total: vendors.length,
    byVertical: verticals.map((vert) => ({
      ...vert,
      count: vendors.filter((v) => v.vertical === vert.slug).length,
    })),
  };

  return (
    <main className="container mx-auto px-4 py-6">
      {/* Hero */}
      <div className="text-center mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">
          Mapa de Comercios
        </h1>
        <p className="text-muted-foreground mt-1 text-sm md:text-base">
          Parque Sicardi y Garibaldi — Explorá los negocios de tu barrio
        </p>
      </div>

      {/* Map + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        {/* Map */}
        <div className="rounded-xl overflow-hidden shadow-md border border-border">
          <MaplibreMap
            center={CENTER}
            zoom={15}
            vendors={vendors}
            verticals={verticals}
            filter={filter}
            neighborhoodFilter={neighborhoodFilter}
          />
        </div>

        {/* Sidebar */}
        <aside className="bg-card border border-border rounded-xl p-4 max-h-[600px] overflow-y-auto">
          <h2 className="font-bold text-sm mb-3">Comercios ({filtered.length})</h2>

          {/* Stats */}
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

          {/* Vertical Filters */}
          <div className="mb-3">
            <h3 className="text-xs font-bold mb-2 text-muted-foreground">Categorías</h3>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setFilter(null)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  !filter
                    ? "bg-primary text-white border-primary"
                    : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
                }`}
              >
                Todos
              </button>
              {stats.byVertical.map((v) => (
                <button
                  key={v.slug}
                  onClick={() => setFilter(filter === v.slug ? null : v.slug)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors flex items-center gap-1 ${
                    filter === v.slug
                      ? "text-white border-transparent"
                      : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                  style={filter === v.slug ? { background: v.hex } : undefined}
                >
                  <span>{v.emoji}</span>
                  {v.name}
                  {v.count > 0 && (
                    <span
                      className={`ml-0.5 text-[9px] px-1 rounded-full ${
                        filter === v.slug ? "bg-white/20" : "bg-muted"
                      }`}
                    >
                      {v.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Neighborhood Filters */}
          <div className="mb-3">
            <h3 className="text-xs font-bold mb-2 text-muted-foreground">Barrios</h3>
            <div className="flex gap-1.5">
              {["sicardi", "garibaldi"].map((nbh) => (
                <button
                  key={nbh}
                  onClick={() => setNeighborhoodFilter(neighborhoodFilter === nbh ? null : nbh)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors capitalize ${
                    neighborhoodFilter === nbh
                      ? "bg-primary text-white border-primary"
                      : "bg-background border-border text-muted-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  {nbh}
                </button>
              ))}
            </div>
          </div>

          {/* Vendor List */}
          <h3 className="text-xs font-bold mb-2 text-muted-foreground">
            Vendedores
          </h3>
          <ul className="space-y-1">
            {filtered.map((v) => (
              <li key={v.id}>
                <Link
                  href={`/tienda/${v.slug}`}
                  className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted transition-colors group"
                >
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
                    <div className="text-[10px] text-muted-foreground capitalize">
                      {v.neighborhood} · {getVerticalName(v.vertical, verticals)}
                    </div>
                  </div>
                  {v.verified && (
                    <span className="text-[10px] text-primary font-bold">✓</span>
                  )}
                </Link>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="text-center text-muted-foreground text-xs py-4">
                No hay comercios con estos filtros
              </li>
            )}
          </ul>

          {/* Legend */}
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
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
