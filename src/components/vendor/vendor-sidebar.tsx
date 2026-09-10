"use client";

import Link from "next/link";
import { useState } from "react";
import { X, Package, ChefHat, ShoppingBag, LayoutGrid, UtensilsCrossed, Settings, BarChart3, History, Star, ExternalLink, LogOut } from "lucide-react";

type Tab = "config" | "menu" | "orders" | "history" | "comanda" | "analytics" | "pos" | "mesas" | "reviews";

interface VendorSidebarProps {
  open: boolean;
  onClose: () => void;
  currentTab: Tab;
  onTabChange: (tab: Tab) => void;
  orderCount: number;
  kitchenCount: number;
  menuCount: number;
  storeName: string;
  storeLogo: string | null;
  storeSlug: string | null;
  isGastro: boolean;
  isModa: boolean;
}

const OPERACION_ITEMS: { tab: Tab; label: string; icon: typeof Package; show: (g: boolean, m: boolean) => boolean; badge?: (orderCount: number, kitchenCount: number) => number }[] = [
  { tab: "orders", label: "Pedidos", icon: Package, show: () => true, badge: (c) => c },
  { tab: "comanda", label: "Comanda", icon: ChefHat, show: (g, m) => !m, badge: (_, c) => c },
  { tab: "pos", label: "Mostrador", icon: ShoppingBag, show: () => true },
  { tab: "mesas", label: "Mesas", icon: LayoutGrid, show: (g, m) => g && !m },
];

const GESTION_ITEMS: { tab: Tab; label: string; icon: typeof UtensilsCrossed; show: (g: boolean, m: boolean) => boolean; suffix?: (count: number) => string }[] = [
  { tab: "menu", label: "Menú", icon: UtensilsCrossed, show: () => true, suffix: (c) => `${c}` },
  { tab: "config", label: "Configuración", icon: Settings, show: () => true },
];

const ANALISIS_ITEMS: { tab: Tab; label: string; icon: typeof BarChart3 }[] = [
  { tab: "analytics", label: "Estadísticas", icon: BarChart3 },
  { tab: "history", label: "Histórico", icon: History },
  { tab: "reviews", label: "Reseñas", icon: Star },
];

export default function VendorSidebar({
  open,
  onClose,
  currentTab,
  onTabChange,
  orderCount,
  kitchenCount,
  menuCount,
  storeName,
  storeLogo,
  storeSlug,
  isGastro,
  isModa,
}: VendorSidebarProps) {
  function handleTab(tab: Tab) {
    onTabChange(tab);
    onClose();
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-full w-64 bg-card border-r border-border
          flex flex-col transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:z-30
          ${open ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
          {storeLogo ? (
            <img src={storeLogo} alt={storeName} className="h-9 w-9 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
              <span className="font-bold text-primary text-sm">{storeName.charAt(0)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm truncate">{storeName}</h2>
            {storeSlug && (
              <a
                href={`/tienda/${storeSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Micrositio <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {/* Operaciones */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Operaciones</p>
            <div className="space-y-0.5">
              {OPERACION_ITEMS.filter((i) => i.show(isGastro, isModa)).map((item) => {
                const count = item.badge ? item.badge(orderCount, kitchenCount) : 0;
                const isActive = currentTab === item.tab;
                return (
                  <button
                    key={item.tab}
                    onClick={() => handleTab(item.tab)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left
                      ${isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    `}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {count > 0 && (
                      <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-red-500 text-white"}`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gestión */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gestión</p>
            <div className="space-y-0.5">
              {GESTION_ITEMS.filter((i) => i.show(isGastro, isModa)).map((item) => {
                const isActive = currentTab === item.tab;
                const suffix = item.suffix ? item.suffix(menuCount) : null;
                const label = item.tab === "menu" && isModa ? "Catálogo" : item.label;
                return (
                  <button
                    key={item.tab}
                    onClick={() => handleTab(item.tab)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left
                      ${isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    `}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                    {suffix && (
                      <span className={`text-xs ${isActive ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {suffix}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Análisis */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Análisis</p>
            <div className="space-y-0.5">
              {ANALISIS_ITEMS.map((item) => {
                const isActive = currentTab === item.tab;
                return (
                  <button
                    key={item.tab}
                    onClick={() => handleTab(item.tab)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left
                      ${isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }
                    `}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    <span className="flex-1">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-border">
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            Volver al sitio
          </Link>
        </div>
      </aside>
    </>
  );
}
