"use client";

import Link from "next/link";
import {
  Menu,
  X,
  Package,
  ChefHat,
  ShoppingBag,
  LayoutGrid,
  UtensilsCrossed,
  Settings,
  BarChart3,
  History,
  Star,
  ExternalLink,
  LogOut,
  Home,
  Sparkles,
  Calculator,
  Bot,
  DollarSign,
  Receipt,
  Users,
  MessageSquare,
  CalendarDays,
  ClipboardList,
  Boxes,
  Image,
  BookOpen,
  Share,
  Gift,
  Monitor,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { ConfigSectionStatus } from "@/components/dashboard/config-nav";
import { PanelUiSwitch } from "@/components/panel-ui/panel-ui-switch";

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
  /** Vertical servicios: menú propio (Presupuestos/Turnos/Cobros/Configuración). */
  isService?: boolean;
  /** Vertical estética: suma Pedidos + Catálogo al menú de servicios. */
  isEstetica?: boolean;
  pendingQuotesCount?: number;
  pendingBookingsCount?: number;
  /** Pendientes offline por pestaña (outbox IndexedDB, Track Ventas F1). */
  pendingPosCount?: number;
  pendingMesasCount?: number;
  planName: string | null;
  planSlug: string | null;
  /** Plan Gestión con facturación (can("fiscal")): muestra la pestaña Facturación. */
  canFiscal?: boolean;
  /** Plan Gestión con inventario (can("inventory")): muestra la pestaña Inventario. */
  canInventory?: boolean;
  /** Plan Gestión con Pantalla TV (can("screens")): muestra la pestaña Pantalla. */
  canScreens?: boolean;
  // Props heredadas de cuando la sidebar mutaba en Config (ya no se usan,
  // pero se conservan opcionales para no tocar a los llamadores).
  /** Secciones de Config (sidebar única): si viene y currentTab es config, la nav las muestra. */
  configNavSections?: string[] | null;
  activeConfigSection?: string;
  onConfigSection?: (id: string) => void;
  configSectionStatus?: (id: string) => ConfigSectionStatus | undefined;
  /** Empleado raso: oculta Gestión, Análisis sensible y links de plan/bot. */
  isEmployee?: boolean;
  /**
   * Empleado o encargado (login "Soy del equipo"): oculta las salidas a lo
   * público — el micrositio y "Volver al sitio". El proxy tampoco lo deja
   * navegar fuera de su panel (ver src/proxy.ts).
   */
  isStaffMember?: boolean;
  /**
   * Modo riel (solo desktop): la sidebar se estrecha a 76px y muestra ícono +
   * etiqueta mini; los grupos (Gestión/Análisis/Bot/Cuenta) abren en flyout.
   *false o con el drawer móvil abierto se ve completa (256px).
   */
  rail?: boolean;
  onToggleRail?: () => void;
}

/** g = gastro · m = moda · c = comercio */
const OPERACION_ITEMS: { tab: Tab; label: string; short: string; icon: typeof Package; show: (g: boolean, m: boolean, c: boolean) => boolean; badge?: (orderCount: number, kitchenCount: number) => number }[] = [
  { tab: "orders", label: "Pedidos", short: "Pedidos", icon: Package, show: () => true, badge: (c) => c },
  { tab: "comanda", label: "Comanda", short: "Comanda", icon: ChefHat, show: (g, m, c) => !m && !c, badge: (_, c) => c },
  { tab: "pos", label: "Mostrador", short: "Mostr.", icon: ShoppingBag, show: () => true },
  { tab: "mesas", label: "Mesas", short: "Mesas", icon: LayoutGrid, show: (g) => g },
  { tab: "caja", label: "Caja", short: "Caja", icon: DollarSign, show: (g, m, c) => g || c || m },
];

const GESTION_ITEMS: { tab: Tab; label: string; short: string; icon: typeof UtensilsCrossed; show: (g: boolean, m: boolean, c: boolean, screens?: boolean) => boolean; suffix?: (count: number) => string }[] = [
  { tab: "menu", label: "Menú", short: "Menú", icon: UtensilsCrossed, show: () => true, suffix: (c) => `${c}` },
  { tab: "promos", label: "Promos", short: "Promos", icon: Share, show: () => true },
  { tab: "recetas", label: "Preparación y Costo", short: "Costo", icon: Calculator, show: (g) => g },
  { tab: "clientes", label: "Clientes", short: "Clientes", icon: Users, show: (g, m, c) => g || c || m },
  { tab: "gastos", label: "Gastos", short: "Gastos", icon: Receipt, show: (g, m, c) => g || c || m },
  { tab: "tarjetas", label: "Tarjetas", short: "Tarjetas", icon: Gift, show: (g, m, c) => c || m },
  // Pantalla TV: carta en el televisor del local (planes con `screens`).
  // Se pasa por prop porque el gate es del plan, no del vertical.
  { tab: "pantalla", label: "Pantalla TV", short: "Pantalla", icon: Monitor, show: (_g, _m, _c, screens) => !!screens },
  { tab: "config", label: "Configuración", short: "Config", icon: Settings, show: () => true },
];

const ANALISIS_ITEMS: { tab: Tab; label: string; icon: typeof BarChart3 }[] = [
  { tab: "analytics", label: "Estadísticas", icon: BarChart3 },
  { tab: "history", label: "Histórico", icon: History },
  { tab: "reviews", label: "Reseñas", icon: Star },
];

/** Ítem del modo riel: ícono arriba, etiqueta mini abajo (sin desplegar). */
function RailItem({
  icon: Icon,
  label,
  active = false,
  badge,
  onClick,
  title,
}: {
  icon: typeof Package;
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title || label}
      className={`
        relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors
        ${active ? "bg-primary-light text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}
      `}
    >
      <span className="relative">
        <Icon className="h-5 w-5" />
        {badge != null && badge > 0 && (
          <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-tight leading-none">
        {label}
      </span>
      {active && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary-accent" />}
    </button>
  );
}


/** Ítem del modo completo (256px). */
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
          title={`${syncBadge} acción${syncBadge === 1 ? "" : "es"} sin sincronizar`}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-warning text-warning-foreground"
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

/** Link del modo completo. */
function NavLink({
  href,
  icon: Icon,
  label,
  external = false,
  children,
}: {
  href: string;
  icon: typeof Package;
  label: string;
  external?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {children}
    </Link>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
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
  rail = false,
  onToggleRail,
}: VendorSidebarProps) {
  function handleTab(tab: Tab) {
    onTabChange(tab);
    onClose();
  }

  // Modo completo: drawer móvil abierto, o escritorio sin riel.
  const wide = open || !rail;
  const toggle = onToggleRail || (() => {});


  // ---- Iconos del riel: Hoy + la operacion del vertical + Catalogo/Menu
  // (o Galeria en servicios) + Configuracion. Segun el perfil: el empleado
  // no ve Catalogo ni Config (no tiene Gestion). El resto se ve al
  // desplegar el menu. ----
  const railItems: {
    tab: Tab;
    label: string;
    title: string;
    icon: typeof Package;
    badge?: number;
  }[] = [{ tab: "hoy", label: "Hoy", title: "Hoy", icon: Home }];

  if (isService) {
    railItems.push({
      tab: "orders",
      label: isEstetica ? "Consultas" : "Presup.",
      title: isEstetica ? "Consultas" : "Presupuestos",
      icon: MessageSquare,
      badge: pendingQuotesCount,
    });
    railItems.push({ tab: "pos", label: "Turnos", title: "Turnos", icon: CalendarDays, badge: pendingBookingsCount });
    railItems.push({ tab: "caja", label: "Caja", title: "Caja", icon: DollarSign });
    if (isEstetica) {
      railItems.push({ tab: "pedidos", label: "Pedidos", title: "Pedidos", icon: Package, badge: orderCount });
      railItems.push({ tab: "mostrador", label: "Mostr.", title: "Mostrador", icon: ShoppingBag });
      if (canFiscal) railItems.push({ tab: "fiscal", label: "Factura", title: "Facturacion", icon: Receipt });
      if (canInventory) railItems.push({ tab: "inventario", label: "Invent.", title: "Inventario", icon: Boxes });
    }
  } else {
    OPERACION_ITEMS.filter((i) => i.show(isGastro, isModa, isComercio)).forEach((item) => {
      const count = item.badge ? item.badge(orderCount, kitchenCount) : 0;
      railItems.push({ tab: item.tab, label: item.short, title: item.label, icon: item.icon, badge: count });
    });
    if (canFiscal) railItems.push({ tab: "fiscal", label: "Factura", title: "Facturacion", icon: Receipt });
    if (canInventory) railItems.push({ tab: "inventario", label: "Invent.", title: "Inventario", icon: Boxes });
  }

  if (!isEmployee) {
    if (isService) {
      railItems.push({ tab: "galeria", label: "Galeria", title: "Galeria", icon: Image });
    } else {
      railItems.push({
        tab: "menu",
        label: isComercio || isModa ? "Catalogo" : "Menu",
        title: isComercio || isModa ? "Catalogo" : "Menu",
        icon: UtensilsCrossed,
      });
    }
    railItems.push({ tab: "config", label: "Config", title: "Configuracion", icon: Settings });
  }
  // ---- Contenido reutilizable ----
  const hoyItem = (
    <NavButton
      key="hoy"
      active={currentTab === "hoy"}
      onClick={() => handleTab("hoy")}
      icon={Home}
      label="Hoy"
    />
  );

  const operaciones = (
    <>
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
                label="Facturación"
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
            label="Facturación"
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
    </>
  );

  const gestion = !isEmployee && (
    <>
      <SectionLabel>Gestión</SectionLabel>
      <div className="space-y-0.5">
        {isService ? (
          <>
            <NavButton active={currentTab === "galeria"} onClick={() => handleTab("galeria")} icon={Image} label="Galería" />
            <NavButton active={currentTab === "config"} onClick={() => handleTab("config")} icon={ClipboardList} label="Configuración" />
            <NavButton active={currentTab === "clientes"} onClick={() => handleTab("clientes")} icon={Users} label="Clientes" />
            <NavButton active={currentTab === "promos"} onClick={() => handleTab("promos")} icon={Share} label="Promos" />
            {isEstetica && (
              <>
                <NavButton active={currentTab === "servicios"} onClick={() => handleTab("servicios")} icon={CalendarDays} label="Servicios" />
                <NavButton active={currentTab === "tarjetas"} onClick={() => handleTab("tarjetas")} icon={Gift} label="Tarjetas" />
              </>
            )}
          </>
        ) : (
          GESTION_ITEMS.filter((i) => i.show(isGastro, isModa, isComercio, canScreens)).map((item) => (
            <NavButton
              key={item.tab}
              active={currentTab === item.tab}
              onClick={() => handleTab(item.tab)}
              icon={item.icon}
              label={item.label}
              suffix={item.tab === "menu" ? item.suffix?.(menuCount) : undefined}
            />
          ))
        )}
      </div>
    </>
  );

  const analisis = (
    <>
      <SectionLabel>Análisis</SectionLabel>
      <div className="space-y-0.5">
        {ANALISIS_ITEMS.filter((i) => !isEmployee || i.tab === "history").map((item) => (
          <NavButton
            key={item.tab}
            active={currentTab === item.tab}
            onClick={() => handleTab(item.tab)}
            icon={item.icon}
            label={item.label}
          />
        ))}
      </div>
    </>
  );

  // Los links que estaban en el footer pasan al menú como secciones propias
  // (así no queda un footer larguísimo y no hace scroll en la primera vista).
  const cuenta = (
    <>
      <SectionLabel>Mi cuenta</SectionLabel>
      <div className="space-y-0.5">
        {planSlug && !isEmployee && (
          <NavLink href="/vendor/suscripcion" icon={Sparkles} label={`Plan ${planName ?? planSlug}`}>
            <span className="text-primary">→</span>
          </NavLink>
        )}
        {!isEmployee && (
          <>
            <NavLink href="/vendor/wa-bot" icon={Bot} label="Bot de WhatsApp" />
            <NavLink href="/vendor/wa-bot/conversaciones" icon={MessageSquare} label="Conversaciones" />
          </>
        )}
        <NavLink href="/manuales" icon={BookOpen} label="Manuales" external />
        <div className="pt-1">
          <PanelUiSwitch />
        </div>
        {!isStaffMember && (
          <NavLink href="/" icon={LogOut} label="Volver al sitio" />
        )}
      </div>
    </>
  );

  // ---- Modo riel (desktop) ----
  if (!wide) {

    return (
      <>
        <aside
          className="
            fixed top-0 left-0 z-50 flex h-full w-[76px] flex-col bg-card border-r border-border
            transition-transform duration-200 ease-in-out lg:z-30 lg:translate-x-0
          "
        >
          {/* Cabecera del riel: botón de menú (patrón Material Navigation
              Rail: el ícono de arriba despliega la barra y revela el resto
              de los destinos). La identidad del comercio vive en la barra
              superior del panel, no acá. */}
          <div className="flex justify-center border-b border-border py-3">
            <button
              type="button"
              onClick={toggle}
              title="Desplegar el menú (más opciones)"
              className="flex h-12 w-12 flex-col items-center justify-center gap-1 rounded-xl text-primary transition-colors hover:bg-primary-light"
            >
              <Menu className="h-5 w-5" />
              <span className="text-[9px] font-semibold uppercase leading-none tracking-tight">Menú</span>
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {/* Riel: Hoy + la operacion del vertical + Catalogo/Menu (o
              Galeria en servicios) + Configuracion. Lo demas --Promos,
              Preparacion, Clientes, Gastos, Tarjetas, Pantalla, Analisis,
              Bot y Cuenta-- aparece al desplegar el menu con el boton de
              arriba. */}
          {railItems.map((item) => (
            <RailItem
              key={item.tab}
              icon={item.icon}
              label={item.label}
              title={item.title}
              badge={item.badge}
              active={currentTab === item.tab}
              onClick={() => handleTab(item.tab)}
            />
          ))}
            </nav>
        </aside>
      </>
    );
  }

  // ---- Modo completo (256px): drawer móvil o escritorio desplegado ----
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 flex h-full w-64 flex-col bg-card border-r border-border
          transition-transform duration-200 ease-in-out lg:z-30 lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Header: la identidad del comercio está en la barra superior del
            panel; acá solo queda el control de plegado. */}
        <div className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Menú</p>
          <button
            type="button"
            onClick={toggle}
            title="Ocultar el menú (modo íconos)"
            className="hidden lg:flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-lg p-1.5 transition-colors hover:bg-muted lg:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav principal (siempre visible, también en la solapa Config). */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          <div>{hoyItem}</div>
          <div>{operaciones}</div>
          {gestion && <div>{gestion}</div>}
          <div>{analisis}</div>
          <div>{cuenta}</div>
        </nav>
      </aside>
    </>
  );
}
