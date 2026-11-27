"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MapPin, ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { ZoneSelector } from "./zone-selector";
import { Logo } from "@/components/brand/logo";
import { SearchBar } from "./search-bar";
import { InstallAppButton } from "./install-app-button";
import { isImmersivePath } from "@/lib/immersive";

export function Navigation() {
  const pathname = usePathname();
  const { count, setOpen } = useCart();
  // Pantalla TV: es una pantalla de local, no una página del portal → sin nav.
  if (isImmersivePath(pathname)) return null;
  const isBackoffice =
    pathname?.startsWith("/vendor") || pathname?.startsWith("/admin");

  // Backoffice (panel del comercio / admin): en desktop no mostramos el nav
  // público (logo + zona + buscador) — cada shell tiene su propia topbar.
  // En mobile conservamos la fila compacta (logo + campana + menú) para no
  // dejar al usuario sin acceso a la cuenta.
  if (isBackoffice) {
    return (
      <nav data-portal-chrome className="pv2 sticky top-0 z-50 bg-card border-b border-border sm:hidden">
        <div className="container mx-auto px-3 h-14 flex items-center gap-2">
          <Link href="/" aria-label="Portal 659 — Inicio" className="flex-shrink-0 h-full flex items-center">
            <Logo />
          </Link>
          <div className="flex-1" />
          <NotificationBell />
          <UserMenu />
        </div>
      </nav>
    );
  }

  return (
    <nav data-portal-chrome className="pv2 border-b border-border bg-card sticky top-0 z-50">
      {/* Desktop: una sola fila (igual que antes) */}
      <div className="hidden sm:flex container mx-auto px-4 h-16 items-center gap-2">
        <Link href="/" aria-label="Portal 659 — Inicio" className="flex-shrink-0 h-full flex items-center">
          <Logo />
        </Link>
        <ZoneSelector />
        <Link
          href="/mapa"
          aria-label="Mapa"
          className={`pv2-pill flex h-10 w-10 flex-shrink-0 items-center justify-center transition-colors ${
            pathname === "/mapa" ? "pv2-active" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MapPin className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </Link>
        <div className="flex-1 min-w-0">
          <SearchBar />
        </div>
        <InstallAppButton />
        <NotificationBell />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ver carrito"
          className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-[var(--pv2-accent-hover)]"
        >
          <ShoppingBag className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          {count > 0 && (
            <span className="pv2-cart-badge absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px]">
              {count}
            </span>
          )}
        </button>
        <UserMenu />
      </div>

      {/* Mobile */}
      <div className="sm:hidden">
        {/* Fila 1: logo + espacio + campana + menú */}
        <div className="container mx-auto px-3 h-14 flex items-center gap-2">
          <Link href="/" aria-label="Portal 659 — Inicio" className="flex-shrink-0 h-full flex items-center">
            <Logo />
          </Link>
          <div className="flex-1" />
          <NotificationBell />
          <UserMenu />
        </div>

        {/* Fila 2: zona + app (solo sitio público) */}
        <div className="container mx-auto px-3 pb-2 flex items-center gap-2">
          <ZoneSelector />
          <Link
            href="/mapa"
            aria-label="Mapa"
            className={`pv2-pill flex h-9 w-9 flex-shrink-0 items-center justify-center transition-colors ${
              pathname === "/mapa" ? "pv2-active" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <MapPin className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </Link>
          <InstallAppButton />
        </div>
      </div>
    </nav>
  );
}