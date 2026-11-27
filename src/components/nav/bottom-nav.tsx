"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Map, Package, Search, ShoppingCart, type LucideIcon } from "lucide-react";
import { useCart } from "@/lib/cart";
import { isImmersivePath } from "@/lib/immersive";

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/buscar", label: "Buscar", icon: Search },
  { href: "/mapa", label: "Mapa", icon: Map },
  { href: "/mis-pedidos", label: "Pedidos", icon: Package },
];

export function BottomNav() {
  const pathname = usePathname();
  const { count, setOpen } = useCart();

  if (
    pathname?.startsWith("/admin") ||
    pathname?.startsWith("/vendor") ||
    pathname?.startsWith("/tienda") ||
    // Pantalla TV: sin barra inferior (es pantalla completa del local).
    isImmersivePath(pathname)
  ) {
    return null;
  }

  return (
    <nav className="pv2 pv2-bottom-nav sm:hidden fixed bottom-0 inset-x-0 z-50" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex h-14 items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active}
              className="pv2-nav-item flex min-w-[48px] flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium transition-colors"
            >
              <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          className="pv2-nav-item relative flex min-w-[48px] flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium transition-colors"
          type="button"
        >
          <ShoppingCart className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          Carrito
          {count > 0 && (
            <span className="pv2-cart-badge absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px]">
              {count}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
