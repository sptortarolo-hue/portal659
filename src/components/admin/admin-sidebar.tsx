"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  X,
  LayoutDashboard,
  Store,
  Users,
  Star,
  FileText,
  Settings,
  LogOut,
  Megaphone,
  BarChart3,
  Tag,
  CreditCard,
  MessageCircle,
  Truck,
  Phone,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { PanelUiSwitch } from "@/components/panel-ui/panel-ui-switch";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", short: "Inicio", icon: LayoutDashboard },
  { href: "/admin/metricas", label: "Métricas", short: "Métricas", icon: BarChart3 },
  { href: "/admin/monitor", label: "Monitor", short: "Monitor", icon: Activity },
  { href: "/admin/logisticas", label: "Portal Envíos", short: "Envíos", icon: Truck },
  { href: "/admin/portal-wa", label: "WA del Portal", short: "WA", icon: Phone },
  { href: "/admin/bots", label: "Bots WhatsApp", short: "Bots", icon: MessageCircle },
  { href: "/admin/comercios", label: "Comercios", short: "Comercios", icon: Store },
  { href: "/admin/suscripciones", label: "Suscripciones", short: "Suscrip.", icon: CreditCard },
  { href: "/admin/usuarios", label: "Usuarios", short: "Usuarios", icon: Users },
  { href: "/admin/resenas", label: "Reseñas", short: "Reseñas", icon: Star },
  { href: "/admin/planes", label: "Planes", short: "Planes", icon: Tag },
  { href: "/admin/auditoria", label: "Auditoría", short: "Auditoría", icon: FileText },
  { href: "/admin/alerta", label: "Alerta Vecinal", short: "Alerta", icon: Megaphone },
  { href: "/admin/config", label: "Configuración", short: "Config", icon: Settings },
];

interface AdminSidebarProps {
  open: boolean;
  onClose: () => void;
  /**
   * Modo riel (solo desktop): 76px con ícono + etiqueta mini. Con el drawer
   * móvil abierto se ve completa (256px), igual que la del comercio.
   */
  rail?: boolean;
  onToggleRail?: () => void;
}

/** Ítem del modo riel: ícono arriba, etiqueta mini abajo. */
function RailLink({
  href,
  icon: Icon,
  label,
  title,
  active = false,
  onNavigate,
}: {
  href: string;
  icon: typeof Store;
  label: string;
  title: string;
  active?: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={title}
      className={`
        relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 transition-colors
        ${active ? "bg-primary-light text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}
      `}
    >
      <Icon className="h-5 w-5" />
      <span className="w-full truncate text-center text-[9px] font-semibold uppercase tracking-tight leading-none">
        {label}
      </span>
      {active && <span className="absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-primary-accent" />}
    </Link>
  );
}

export default function AdminSidebar({
  open,
  onClose,
  rail = false,
  onToggleRail,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || (href !== "/admin" && pathname.startsWith(href));
  const wide = open || !rail;
  const toggle = onToggleRail || (() => {});

  // ---- Modo riel ----
  if (!wide) {
    return (
      <aside className="fixed top-0 left-0 z-50 flex h-full w-[76px] flex-col border-r border-border bg-card transition-transform duration-200 ease-in-out lg:z-30 lg:translate-x-0">
        <div className="flex flex-col items-center gap-2 border-b border-border py-3">
          <Link
            href="/admin"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-light text-sm font-bold text-primary"
            title="Panel Admin"
          >
            P
          </Link>
          <button
            type="button"
            onClick={toggle}
            title="Desplegar el menú"
            className="hidden lg:flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {NAV_ITEMS.map((item) => (
            <RailLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.short}
              title={item.label}
              active={isActive(item.href)}
              onNavigate={onClose}
            />
          ))}
        </nav>
        <div className="border-t border-border px-2 py-2">
          <Link
            href="/"
            title="Volver al sitio"
            className="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[9px] font-semibold uppercase tracking-tight leading-none">Salir</span>
          </Link>
        </div>
      </aside>
    );
  }

  // ---- Modo completo ----
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} />}

      <aside
        className={`
          fixed top-0 left-0 z-50 flex h-full w-64 flex-col border-r border-border bg-card
          transition-transform duration-200 ease-in-out lg:z-30 lg:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <Link
            href="/admin"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-primary-light font-display text-base font-bold text-primary"
          >
            P
          </Link>
          <Link href="/admin" onClick={onClose} className="min-w-0 flex-1 truncate font-display text-lg font-semibold">
            Panel Admin
          </Link>
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

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={`
                flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
                ${isActive(item.href)
                  ? "bg-primary-light text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }
              `}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="space-y-1 border-t border-border px-3 py-4">
          <PanelUiSwitch />
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            Volver al sitio
          </Link>
        </div>
      </aside>
    </>
  );
}
