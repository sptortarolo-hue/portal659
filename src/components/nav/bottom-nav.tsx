"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/buscar", label: "Buscar", icon: "🔍" },
  { href: "/mapa", label: "Mapa", icon: "🗺️" },
  { href: "/mis-pedidos", label: "Pedidos", icon: "📦" },
];

export function BottomNav() {
  const pathname = usePathname();
  const { count, setOpen } = useCart();

  if (
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/vendor") ||
    pathname?.startsWith("/tienda")
  ) {
    return null;
  }

  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex items-center justify-around h-14">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-1 px-2 min-w-[48px] text-[11px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          className="relative flex flex-col items-center gap-0.5 py-1 px-2 min-w-[48px] text-[11px] font-medium text-muted-foreground"
          type="button"
        >
          <span className="text-xl">🛒</span>
          Carrito
          {count > 0 && (
            <span className="absolute top-0 right-0 flex items-center justify-center h-4 min-w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
              {count}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
