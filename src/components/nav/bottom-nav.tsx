"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";
import { useTheme } from "@/components/ui/theme-provider";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: "🏠" },
  { href: "/buscar", label: "Buscar", icon: "🔍" },
  { href: "/mapa", label: "Mapa", icon: "🗺️" },
  { href: "/mis-pedidos", label: "Pedidos", icon: "📦" },
];

export function BottomNav() {
  const pathname = usePathname();
  const { count, setOpen } = useCart();
  const { theme, setTheme, resolved } = useTheme();

  const cycleTheme = () => {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  };

  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-sm border-t border-border z-50">
      <div className="flex items-center justify-around h-14">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          className="relative flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium text-muted-foreground"
        >
          <span className="text-lg">🛒</span>
          Carrito
          {count > 0 && (
            <span className="absolute -top-0.5 right-1 flex items-center justify-center h-4 min-w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
              {count}
            </span>
          )}
        </button>
        <button
          onClick={cycleTheme}
          className="flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium text-muted-foreground"
          title={resolved === "dark" ? "Modo claro" : "Modo oscuro"}
        >
          <span className="text-lg">{resolved === "dark" ? "🌙" : "☀️"}</span>
          {resolved === "dark" ? "Noche" : "Día"}
        </button>
      </div>
    </nav>
  );
}
