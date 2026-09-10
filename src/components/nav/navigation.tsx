"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { ZoneSelector } from "./zone-selector";
import { Logo } from "@/components/brand/logo";
import { SearchBar } from "./search-bar";
import { InstallAppButton } from "./install-app-button";

export function Navigation() {
  const pathname = usePathname();
  const isBackoffice =
    pathname?.startsWith("/vendor") || pathname?.startsWith("/admin");

  // Backoffice (panel del comercio / admin): en desktop no mostramos el nav
  // público (logo + zona + buscador) — cada shell tiene su propia topbar.
  // En mobile conservamos la fila compacta (logo + campana + menú) para no
  // dejar al usuario sin acceso a la cuenta.
  if (isBackoffice) {
    return (
      <nav className="sticky top-0 z-50 bg-card/80 backdrop-blur-sm border-b border-border sm:hidden">
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
    <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      {/* Desktop: una sola fila (igual que antes) */}
      <div className="hidden sm:flex container mx-auto px-4 h-16 items-center gap-2">
        <Link href="/" aria-label="Portal 659 — Inicio" className="flex-shrink-0 h-full flex items-center">
          <Logo />
        </Link>
        <ZoneSelector />
        <div className="flex-1 min-w-0">
          <SearchBar />
        </div>
        <InstallAppButton />
        <NotificationBell />
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
          <InstallAppButton />
        </div>
      </div>
    </nav>
  );
}