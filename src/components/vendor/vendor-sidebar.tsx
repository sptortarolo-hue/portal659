"use client";

import Link from "next/link";
import { X, Package, ChefHat, ShoppingBag, LayoutGrid, UtensilsCrossed, Settings, BarChart3, History, Star, ExternalLink, LogOut, Home, Sparkles, Calculator, Bot, DollarSign, Receipt, Users, MessageSquare, CalendarDays, ClipboardList, Boxes, Image, BookOpen, Share, Gift, Monitor } from "lucide-react";
import type { ConfigSectionStatus } from "@/components/dashboard/config-nav";

type Tab = "hoy" | "config" | "menu" | "orders" | "pedidos" | "mostrador" | "history" | "comanda" | "analytics" | "pos" | "mesas" | "caja" | "gastos" | "clientes" | "reviews" | "recetas" | "fiscal" | "inventario" | "galeria" | "promos" | "tarjetas" | "pantalla" | "servicios";

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
  /** Vertical servicios: menÃº propio (Presupuestos/Turnos/Cobros/ConfiguraciÃ³n). */
  isService?: boolean;
  /** Vertical estÃ©tica: suma Pedidos + CatÃ¡logo al menÃº de servicios. */
  isEstetica?: boolean;
  pendingQuotesCount?: number;
  pendingBookingsCount?: number;
  /** Pendientes offline por pestaÃ±a (outbox IndexedDB, Track Ventas F1). */
  pendingPosCount?: number;
  pendingMesasCount?: number;
  planName: string | null;
  planSlug: string | null;
  /** Plan GestiÃ³n con facturaciÃ³n (can("fiscal")): muestra la pestaÃ±a FacturaciÃ³n. */
  canFiscal?: boolean;
  /** Plan GestiÃ³n con inventario (can("inventory")): muestra la pestaÃ±a Inventario. */
  canInventory?: boolean;
  /** Plan GestiÃ³n con Pantalla TV (can("screens")): muestra la pestaÃ±a Pantalla. */
  canScreens?: boolean;
  // Props heredadas de cuando la sidebar mutaba en Config (ya no se usan,
  // pero se conservan opcionales para no tocar a los llamadores).
  /** Secciones de Config (sidebar Ãºnica): si viene y currentTab es config, la nav las muestra. */
  configNavSections?: string[] | null;
  activeConfigSection?: string;
  onConfigSection?: (id: string) => void;
  configSectionStatus?: (id: string) => ConfigSectionStatus | undefined;
  /** Empleado raso: oculta GestiÃ³n, AnÃ¡lisis sensible y links de plan/bot. */
  isEmployee?: boolean;
  /**
   * Empleado o encargado (login "Soy del equipo"): oculta las salidas a lo
   * pÃºblico â€” el micrositio y "Volver al sitio". El proxy tampoco lo deja
   * navegar fuera de su panel (ver src/proxy.ts).
   */
  isStaffMember?: boolean;
}

/** g = gastro Â· m = moda Â· c = comercio */
const OPERACION_ITEMS: { tab: Tab; label: string; icon: typeof Package; show: (g: boolean, m: boolean, c: boolean) => boolean; badge?: (orderCount: number, kitchenCount: number) => number }[] = [
  { tab: "orders", label: "Pedidos", icon: Package, show: () => true, badge: (c) => c },
  { tab: "comanda", label: "Comanda", icon: ChefHat, show: (g, m, c) => !m && !c, badge: (_, c) => c },
  { tab: "pos", label: "Mostrador", icon: ShoppingBag, show: () => true },
  { tab: "mesas", label: "Mesas", icon: LayoutGrid, show: (g) => g },
  { tab: "caja", label: "Caja", icon: DollarSign, show: (g, m, c) => g || c || m },
];

const GESTION_ITEMS: { tab: Tab; label: string; icon: typeof UtensilsCrossed; show: (g: boolean, m: boolean, c: boolean, screens?: boolean) => boolean; suffix?: (count: number) => string }[] = [
  { tab: "menu", label: "MenÃº", icon: UtensilsCrossed, show: () => true, suffix: (c) => `${c}` },
  { tab: "promos", label: "Promos", icon: Share, show: () => true },
  { tab: "recetas", label: "PreparaciÃ³n y Costo", icon: Calculator, show: (g) => g },
  { tab: "clientes", label: "Clientes", icon: Users, show: (g, m, c) => g || c || m },
  { tab: "gastos", label: "Gastos", icon: Receipt, show: (g, m, c) => g || c || m },
  { tab: "tarjetas", label: "Tarjetas", icon: Gift, show: (g, m, c) => c || m },
  // Pantalla TV: carta en el televisor del local (planes con `screens`).
  // Se pasa por prop porque el gate es del plan, no del vertical.
  { tab: "pantalla", label: "Pantalla TV", icon: Monitor, show: (_g, _m, _c, screens) => !!screens },
  { tab: "config", label: "ConfiguraciÃ³n", icon: Settings, show: () => true },
];

const ANALISIS_ITEMS: { tab: Tab; label: string; icon: typeof BarChart3 }[] = [
  { tab: "analytics", label: "EstadÃ­sticas", icon: BarChart3 },
  { tab: "history", label: "HistÃ³rico", icon: History },
  { tab: "reviews", label: "ReseÃ±as", icon: Star },
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
  /** Pendientes offline: pÃ­ldora Ã¡mbar con conteo (no tapa el badge rojo). */
  syncBadge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-r-lg border-l-2 text-sm font-medium transition-colors text-left
        ${active
          ? "bg-primary-light text-primary border-l-primary-accent"
          : "text-muted-foreground border-l-transparent hover:bg-muted hover:text-foreground"
        }
      `}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-danger text-white">
          {badge}
        </span>
      )}
      {syncBadge != null && syncBadge > 0 && (
        <span
          title={`${syncBadge} acciÃ³n${syncBadge === 1 ? "" : "es"} sin sincronizar`}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-warning text-warning-foreground"
        >
          â‡…{syncBadge}
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
  isEstetica = false,
  pendingQuotesCount = 0,
  pendingBookingsCount = 0,
  pendingPosCount = 0,
  pendingMesasCount = 0,
  planName,
  planSlug,
  canFiscal = false,
  canInventory = false,
  canScreens = false,
  isEmployee = false,
  isStaffMember = false,
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
          fixed top-0 left-0 z-50 h-full w-64 sidebar-desktop bg-card
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
            <div className="h-9 w-9 rounded-full bg-primary-light flex items-center justify-center flex-shrink-0">
              <span className="font-bold text-primary text-sm">{storeName.charAt(0)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-sm truncate text-text-main">{storeName}</h2>
            {storeSlug && !isStaffMember && (
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

        {/* Nav principal (siempre visible, tambiÃ©n en la solapa Config). */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
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
                    label={isEstetica ? "Consultas" : "Presupuestos"}
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
                    label="Caja"
                  />
                  {isEstetica && (
                    <>
                      <NavButton
                        active={currentTab === "pedidos"}
                        onClick={() => handleTab("pedidos")}
                        icon={Package}
                        label="Pedidos"
                        badge={orderCount}
                      />
                      <NavButton
                        active={currentTab === "mostrador"}
                        onClick={() => handleTab("mostrador")}
                        icon={ShoppingBag}
                        label="Mostrador"
                      />
                    </>
                  )}
                  {isEstetica && canFiscal && (
                    <NavButton
                      active={currentTab === "fiscal"}
                      onClick={() => handleTab("fiscal")}
                      icon={Receipt}
                      label="FacturaciÃ³n"
                    />
                  )}
                  {isEstetica && canInventory && (
                    <NavButton
                      active={currentTab === "inventario"}
                      onClick={() => handleTab("inventario")}
                      icon={Boxes}
                      label="Inventario"
                    />
                  )}
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
              {!isService && canFiscal && (
                <NavButton
                  active={currentTab === "fiscal"}
                  onClick={() => handleTab("fiscal")}
                  icon={Receipt}
                  label="FacturaciÃ³n"
                />
              )}
              {!isService && canInventory && (
                <NavButton
                  active={currentTab === "inventario"}
                  onClick={() => handleTab("inventario")}
                  icon={Boxes}
                  label="Inventario"
                />
              )}
            </div>
          </div>

          {/* GestiÃ³n â€” el empleado opera sin gestiÃ³n (ni menÃº, ni clientes, ni config) */}
          {!isEmployee && (
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">GestiÃ³n</p>
            <div className="space-y-0.5">
              {isService ? (
                <>
                  <NavButton
                    active={currentTab === "galeria"}
                    onClick={() => handleTab("galeria")}
                    icon={Image}
                    label="GalerÃ­a"
                  />
                  <NavButton
                    active={currentTab === "config"}
                    onClick={() => handleTab("config")}
                    icon={ClipboardList}
                    label="ConfiguraciÃ³n"
                  />
                  <NavButton
                    active={currentTab === "clientes"}
                    onClick={() => handleTab("clientes")}
                    icon={Users}
                    label="Clientes"
                  />
                  <NavButton
                    active={currentTab === "promos"}
                    onClick={() => handleTab("promos")}
                    icon={Share}
                    label="Promos"
                  />
                  {isEstetica && (
                    <NavButton
                      active={currentTab === "gastos"}
                      onClick={() => handleTab("gastos")}
                      icon={Receipt}
                      label="Gastos"
                    />
                  )}
                  {isEstetica && (
                    <NavButton
                      active={currentTab === "tarjetas"}
                      onClick={() => handleTab("tarjetas")}
                      icon={Gift}
                      label="Tarjetas"
                    />
                  )}
                  {isEstetica && (
                    <NavButton
                      active={currentTab === "menu"}
                      onClick={() => handleTab("menu")}
                      icon={ShoppingBag}
                      label="CatÃ¡logo"
                      suffix={`${menuCount}`}
                    />
                  )}
                  {isEstetica && (
                    <NavButton
                      active={currentTab === "servicios"}
                      onClick={() => handleTab("servicios")}
                      icon={Sparkles}
                      label="Servicios"
                    />
                  )}
                </>
              ) : (
                <>
                {GESTION_ITEMS.filter((i) => i.show(isGastro, isModa, isComercio, canScreens ?? false)).map((item) => {
                  const suffix = item.suffix ? item.suffix(menuCount) : null;
                  const label = item.tab === "menu" && (isModa || isComercio) ? "CatÃ¡logo" : item.label;
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
                {isComercio && (
                  <NavButton
                    active={currentTab === "galeria"}
                    onClick={() => handleTab("galeria")}
                    icon={Image}
                    label="GalerÃ­a"
                  />
                )}
                </>
              )}
            </div>
          </div>
          )}

          {/* AnÃ¡lisis â€” el empleado solo ve el histÃ³rico */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">AnÃ¡lisis</p>
            <div className="space-y-0.5">
              {((isService && !isEstetica) ? ANALISIS_ITEMS.filter((i) => i.tab !== "analytics") : ANALISIS_ITEMS)
                .filter((i) => !isEmployee || i.tab === "history")
                .map((item) => (
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
        </nav>

        {/* Footer â€” el equipo (empleado/encargado) no ve plan ni bot: esas
            secciones son del dueÃ±o (el proxy las manda al dashboard). */}
        <div className="px-3 py-3 border-t border-border space-y-2">
          {planSlug && !isStaffMember && (
            <Link
              href="/vendor/suscripcion"
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="flex-1 truncate">Plan {planName ?? planSlug}</span>
              <span className="text-primary">â†’</span>
            </Link>
          )}
          {!isStaffMember && (
           <>
          <Link
            href="/vendor/wa-bot"
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Bot className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate">Bot de WhatsApp</span>
          </Link>
          <Link
            href="/vendor/wa-bot/conversaciones"
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate">Conversaciones del bot</span>
          </Link>
           </>
          )}
          <Link
            href="/manuales"
            target="_blank"
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <BookOpen className="h-4 w-4 text-primary" />
            <span className="flex-1 truncate">Manuales</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
          {/* "Volver al sitio" no aplica al equipo: se queda en su panel. */}
          {!isStaffMember && (
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            Volver al sitio
          </Link>
          )}
        </div>
      </aside>
    </>
  );
}