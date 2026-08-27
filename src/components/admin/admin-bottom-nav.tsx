"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Store, Users, Star, Settings, Megaphone } from "lucide-react";

const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/comercios", label: "Comercios", icon: Store },
  { href: "/admin/usuarios", label: "Usuarios", icon: Users },
  { href: "/admin/resenas", label: "Reseñas", icon: Star },
  { href: "/admin/alerta", label: "Alerta", icon: Megaphone },
  { href: "/admin/config", label: "Config", icon: Settings },
];

export default function AdminBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-card border-t border-border sm:hidden safe-area-inset">
      <div className="flex items-center justify-around py-2">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-medium transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
