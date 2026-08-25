import Link from "next/link";
import { UserMenu } from "./user-menu";
import { Logo } from "@/components/brand/logo";
import { SearchBar } from "./search-bar";
import { NotificationBell } from "./notification-bell";

export function Navigation() {
  return (
    <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center gap-1 sm:gap-2">
        <Link href="/" aria-label="Portal 659 — Inicio" className="flex-shrink-0">
          <Logo />
        </Link>
        <div className="flex-1 min-w-0">
          <SearchBar />
        </div>
        <NotificationBell />
        <div className="flex-shrink-0">
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
