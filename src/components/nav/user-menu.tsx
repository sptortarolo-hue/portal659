"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "@/components/nav/theme-toggle";

type User = {
  id: string;
  email: string;
  name: string;
};

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMenuOpen(false);
    router.push("/");
  }

  if (loading) {
    return <div className="w-9 h-9 bg-muted rounded-full animate-pulse" />;
  }

  return (
    <div className="flex items-center gap-2" ref={menuRef}>
      <ThemeToggle />
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-primary/10 transition-colors text-lg"
          aria-label="Menú"
        >
          {user ? "👤" : "☰"}
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-card border border-border rounded-xl shadow-lg py-2 z-50 animate-fade-in-up">
            {user ? (
              <>
                <div className="px-4 py-2 border-b border-border">
                  <p className="text-sm font-medium truncate">{user.name || user.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
                <Link
                  href="/mis-pedidos"
                  className="block px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  📦 Mis pedidos
                </Link>
                <Link
                  href="/vendor/dashboard"
                  className="block px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  🏪 Mi cuenta
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                >
                  Cerrar sesión
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/mis-pedidos"
                  className="block px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  📦 Mis pedidos
                </Link>
                <Link
                  href="/login"
                  className="block px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  🔑 Iniciar sesión
                </Link>
                <Link
                  href="/register"
                  className="block px-4 py-2.5 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  🏪 Sumá tu comercio
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
