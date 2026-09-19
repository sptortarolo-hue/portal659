"use client";

import Link from "next/link";
import { useState } from "react";
import { X, Package, ChefHat, ShoppingBag, LayoutGrid, UtensilsCrossed, Settings, BarChart3, History, Star, ExternalLink, LogOut, Home, Sparkles, Calculator, Bot, DollarSign, Users } from "lucide-react";

type Tab = "hoy" | "config" | "menu" | "orders" | "history" | "comanda" | "analytics" | "pos" | "mesas" | "caja" | "clientes" | "reviews" | "recetas";

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
  planName: string | null;
  planSlug: string | null;
}

const OPERACION_ITEMS: { tab: Tab; label: string; icon: typeof Package; show: (g: boolean, m: boolean) => boolean; badge?: (orderCount: number, kitchenCount: number) => number }[] = [
  { tab: "orders", label: "Pedidos", icon: Package, show: () => true, badge: (c) => c },
  { tab: "comanda", label: "Comanda", icon: ChefHat, show: (g, m) => !m, badge: (_, c) => c },
  { tab: "pos", label: "Mostrador", icon: ShoppingBag, show: () => true },
  { tab: "mesas", label: "Mesas", icon: LayoutGrid, show: (g, m) => g && !m },
  { tab: "caja", label: "Caja", icon: DollarSign, show: (g, m) => g && !m },
];

const GESTION_ITEMS: { tab: Tab; label: string; icon: typeof UtensilsCrossed; show: (g: boolean, m: boolean) => boolean; suffix?: (count: number) => string }[] = [
  { tab: "menu", label: "Menú", icon: UtensilsCrossed, show: () => true, suffix: (c) => `${c}` },
  { tab: "recetas", label: "Recetas", icon: Calculator, show: (g) => g },
  { tab: "clientes", label: "Clientes", icon: Users, show: (g) => g },
  { tab: "config", label: "Configuración", icon: Settings, show: () => true },
];

const ANALISIS_ITEMS: { tab: Tab; label: string; icon: typeof BarChart3 }[] = [
  { tab: "analytics", label: "Estadísticas", icon: BarChart3 },
  { tab: "history", label: "Histórico", icon: History },
  { tab: "reviews", label: "Reseñas", icon: Star },
];

function NavButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
  suffix,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Package;
  label: string;
  badge?: number;
  suffix?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-r-lg border-l-2 text-sm font-medium transition-colors text-left
        ${active
          ? "bg-primary/10 text-primary border-l-primary"
          : "text-muted-foreground border-l-transparent hover:bg-muted hover:text-foreground"
        }
      `}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-red-500 text-white">
          {badge}
        </span>
      )}
      {suffix != null && (
        <span className={`text-xs ${active ? "text-primary/70" : "text-muted-foreground"}`}>
          {suffix}
        </span>
      )}
    </button>
  );
}

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
  planName,
  planSlug,
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
          {/* Inicio */}
          <div>
            <NavButton
              active={currentTab === "hoy"}
              onClick={() => handleTab("hoy")}
              icon={Home}
              label="Hoy"
            />
          </div>

          {/* Operaciones */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Operaciones</p>
            <div className="space-y-0.5">
              {OPERACION_ITEMS.filter((i) => i.show(isGastro, isModa)).map((item) => {
                const count = item.badge ? item.badge(orderCount, kitchenCount) : 0;
                return (
                  <NavButton
                    key={item.tab}
                    active={currentTab === item.tab}
                    onClick={() => handleTab(item.tab)}
                    icon={item.icon}
                    label={item.label}
                    badge={count}
                  />
                );
              })}
            </div>
          </div>

          {/* Gestión */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gestión</p>
            <div className="space-y-0.5">
              {GESTION_ITEMS.filter((i) => i.show(isGastro, isModa)).map((item) => {
                const suffix = item.suffix ? item.suffix(menuCount) : null;
                const label = item.tab === "menu" && isModa ? "Catálogo" : item.label;
                return (
                  <NavButton
                    key={item.tab}
                    active={currentTab === item.tab}
                    onClick={() => handleTab(item.tab)}
                    icon={item.icon}
                    label={label}
                    suffix={suffix ?? undefined}
                  />
                );
              })}
            </div>
          </div>

          {/* Análisis */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Análisis</p>
            <div className="space-y-0.5">
              {ANALISIS_ITEMS.map((item) => (
                <NavButton
                  key={item.tab}
                  active={currentTab === item.tab}
                  onClick={() => handleTab(item.tab)}
                  icon={item.icon}
                  label={item.label}
                />
              ))}
            </div>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-border space-y-2">
          {planSlug && (
            <Link
              href="/vendor/suscripcion"
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="flex-1 truncate">Plan {planName ?? planSlug}</span>
              <span className="text-primary">→</span>
            </Link>
          )}
          <Link
            href="/vendor/wa-bot"
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Bot className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate">Bot de WhatsApp</span>
          </Link>
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