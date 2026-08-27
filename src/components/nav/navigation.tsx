"use client";

import Link from "next/link";
import { UserMenu } from "./user-menu";
import { NotificationBell } from "./notification-bell";
import { ZoneSelector } from "./zone-selector";
import { Logo } from "@/components/brand/logo";
import { SearchBar } from "./search-bar";

export function Navigation() {
  return (
    <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center gap-2">
        <Link href="/" aria-label="Portal 659 — Inicio" className="flex-shrink-0">
          <Logo />
        </Link>
        <ZoneSelector />
        <div className="flex-1 min-w-0">
          <SearchBar />
        </div>
        <NotificationBell />
          <UserMenu />
      </div>
    </nav>
  );
}
