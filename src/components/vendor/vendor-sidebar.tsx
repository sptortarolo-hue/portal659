"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X, Package, ChefHat, ShoppingBag, LayoutGrid, UtensilsCrossed, Settings, BarChart3, History, Star, ExternalLink, LogOut, Home, Sparkles, Calculator, Bot, DollarSign, Users, MessageSquare, CalendarDays, ClipboardList, ChevronLeft } from "lucide-react";
import {
  CONFIG_SECTION_GROUPS,
  CONFIG_SECTION_LABELS,
  configSectionIcon,
  type ConfigSectionStatus,
} from "@/components/dashboard/config-nav";
import { StatusDot } from "@/components/dashboard/config-sections";

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
  isComercio?: boolean;
  /** Vertical servicios: menú propio (Presupuestos/Turnos/Cobros/Ficha). */
  isService?: boolean;
  pendingQuotesCount?: number;
  pendingBookingsCount?: number;
  /** Pendientes offline por pestaña (outbox IndexedDB, Track Ventas F1). */
  pendingPosCount?: number;
  pendingMesasCount?: number;
  planName: string | null;
  planSlug: string | null;
  /** Secciones de Config (sidebar única): si viene y currentTab es config, la nav las muestra. */
  configNavSections?: string[] | null;
  activeConfigSection?: string;
  onConfigSection?: (id: string) => void;
  configSectionStatus?: (id: string) => ConfigSectionStatus | undefined;
}

/** g = gastro · m = moda · c = comercio */
const OPERACION_ITEMS: { tab: Tab; label: string; icon: typeof Package; show: (g: boolean, m: boolean, c: boolean) => boolean; badge?: (orderCount: number, kitchenCount: number) => number }[] = [
  { tab: "orders", label: "Pedidos", icon: Package, show: () => true, badge: (c) => c },
  { tab: "comanda", label: "Comanda", icon: ChefHat, show: (g, m, c) => !m && !c, badge: (_, c) => c },
  { tab: "pos", label: "Mostrador", icon: ShoppingBag, show: () => true },
  { tab: "mesas", label: "Mesas", icon: LayoutGrid, show: (g) => g },
  { tab: "caja", label: "Caja", icon: DollarSign, show: (g, m, c) => g || c || m },
];

const GESTION_ITEMS: { tab: Tab; label: string; icon: typeof UtensilsCrossed; show: (g: boolean, m: boolean, c: boolean) => boolean; suffix?: (count: number) => string }[] = [
  { tab: "menu", label: "Menú", icon: UtensilsCrossed, show: () => true, suffix: (c) => `${c}` },
  { tab: "recetas", label: "Recetas", icon: Calculator, show: (g) => g },
  { tab: "clientes", label: "Clientes", icon: Users, show: (g, m, c) => g || c || m },
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
  syncBadge,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Package;
  label: string;
  badge?: number;
  suffix?: string;
  /** Pendientes offline: píldora ámbar con conteo (no tapa el badge rojo). */
  syncBadge?: number;
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
      {syncBadge != null && syncBadge > 0 && (
        <span
          title={`${syncBadge} acción${syncBadge === 1 ? "" : "es"} sin sincronizar`}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-amber-400 text-amber-950"
        >
          ⇅{syncBadge}
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
  isComercio = false,
  isService = false,
  pendingQuotesCount = 0,
  pendingBookingsCount = 0,
  pendingPosCount = 0,
  pendingMesasCount = 0,
  planName,
  planSlug,
  configNavSections,
  activeConfigSection,
  onConfigSection,
  configSectionStatus,
}: VendorSidebarProps) {
  function handleTab(tab: Tab) {
    onTabChange(tab);
    onClose();
  }

  // En la pestaña Config, la sidebar muestra las secciones (una sola nav).
  // "Atrás" vuelve a la lista de pestañas sin salir de Config.
  const [sectionsOpen, setSectionsOpen] = useState(true);
  useEffect(() => {
    setSectionsOpen(true);
  }, [currentTab]);
  const showSections =
    currentTab === "config" && (configNavSections?.length ?? 0) > 0 && sectionsOpen;

  function handleSection(id: string) {
    onConfigSection?.(id);
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

        {/* Nav: en Config muestra las secciones (una sola nav), si no las pestañas. */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {showSections && configNavSections ? (
            <>
              <div>
                <button
                  onClick={() => setSectionsOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-primary hover:bg-primary/10 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 flex-shrink-0" />
                  Menú principal
                </button>
              </div>
              {CONFIG_SECTION_GROUPS.map((g) => {
                const items = (configNavSections ?? []).filter((id) => g.sections.includes(id));
                if (items.length === 0) return null;
                return (
                  <div key={g.id}>
                    <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.label}</p>
                    <div className="space-y-0.5">
                      {items.map((id) => {
                        const Icon = configSectionIcon(id);
                        const st = configSectionStatus?.(id);
                        return (
                          <button
                            key={id}
                            onClick={() => handleSection(id)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left transition-colors ${
                              activeConfigSection === id
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            }`}
                          >
                            <Icon className="h-5 w-5 flex-shrink-0" />
                            <span className="flex-1">{CONFIG_SECTION_LABELS[id] ?? id}</span>
                            {st && <StatusDot status={st} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
          <>
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
              {isService ? (
                <>
                  <NavButton
                    active={currentTab === "orders"}
                    onClick={() => handleTab("orders")}
                    icon={MessageSquare}
                    label="Presupuestos"
                    badge={pendingQuotesCount}
                  />
                  <NavButton
                    active={currentTab === "pos"}
                    onClick={() => handleTab("pos")}
                    icon={CalendarDays}
                    label="Turnos"
                    badge={pendingBookingsCount}
                  />
                  <NavButton
                    active={currentTab === "caja"}
                    onClick={() => handleTab("caja")}
                    icon={DollarSign}
                    label="Cobros"
                  />
                </>
              ) : (
                OPERACION_ITEMS.filter((i) => i.show(isGastro, isModa, isComercio)).map((item) => {
                  const count = item.badge ? item.badge(orderCount, kitchenCount) : 0;
                  const sync =
                    item.tab === "pos" ? pendingPosCount ?? 0
                    : item.tab === "mesas" ? pendingMesasCount ?? 0
                    : 0;
                  return (
                    <NavButton
                      key={item.tab}
                      active={currentTab === item.tab}
                      onClick={() => handleTab(item.tab)}
                      icon={item.icon}
                      label={item.label}
                      badge={count}
                      syncBadge={sync}
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* Gestión */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gestión</p>
            <div className="space-y-0.5">
              {isService ? (
                <NavButton
                  active={currentTab === "config"}
                  onClick={() => handleTab("config")}
                  icon={ClipboardList}
                  label="Ficha"
                />
              ) : (
                GESTION_ITEMS.filter((i) => i.show(isGastro, isModa, isComercio)).map((item) => {
                  const suffix = item.suffix ? item.suffix(menuCount) : null;
                  const label = item.tab === "menu" && (isModa || isComercio) ? "Catálogo" : item.label;
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
                })
              )}
            </div>
          </div>

          {/* Análisis */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Análisis</p>
            <div className="space-y-0.5">
              {(isService ? ANALISIS_ITEMS.filter((i) => i.tab !== "analytics") : ANALISIS_ITEMS).map((item) => (
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
          </>
          )}
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