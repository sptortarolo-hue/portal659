"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/ui/theme-provider";
import { Shield } from "lucide-react";

type MeUser = {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
};

type MeStaff = {
  role: string;
  store_name: string;
  vendor_id: string;
};

type MeVendor = {
  id: string;
  slug: string;
  store_name: string;
  logo_url: string | null;
  image_url: string | null;
  vertical: string | null;
};

export function UserMenu() {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<MeUser | null>(null);
  const [vendor, setVendor] = useState<MeVendor | null>(null);
  const [staff, setStaff] = useState<MeStaff | null>(null);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme, resolved } = useTheme();

  useEffect(() => {
    function checkAuth() {
      fetch("/api/auth/me", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          setUser(data.user || null);
          setVendor(data.vendor || null);
          setStaff(data.staff || null);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
    checkAuth();
    window.addEventListener("focus", checkAuth);
    window.addEventListener("auth-changed", checkAuth);
    return () => {
      window.removeEventListener("focus", checkAuth);
      window.removeEventListener("auth-changed", checkAuth);
    };
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

  const cycleTheme = () => {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
  };

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch { /* noop */ }
    setUser(null);
    window.dispatchEvent(new Event("auth-changed"));
    setMenuOpen(false);
    router.push("/");
    router.refresh();
  }

  const isAdmin = user?.is_admin === true;
  const vendorImg = vendor?.logo_url || vendor?.image_url || null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="h-10 flex items-center gap-1.5 rounded-full bg-muted hover:bg-primary/10 active:bg-primary/20 transition-colors text-sm font-medium pl-1 pr-3"
        aria-label="Menú"
      >
        {vendorImg ? (
          <img src={vendorImg} alt={vendor?.store_name || "Mi comercio"} className="h-8 w-8 rounded-full object-cover flex-shrink-0" />
        ) : (
          <span className="w-8 h-8 flex items-center justify-center rounded-full bg-primary/10 text-primary text-lg">☰</span>
        )}
        <span className="hidden sm:inline">Menú</span>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-card border border-border rounded-xl shadow-lg py-2 z-50 animate-fade-in-up">
          <button
            onClick={() => { cycleTheme(); }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
          >
            <span>{resolved === "dark" ? "🌙" : "☀️"}</span>
            <span>{resolved === "dark" ? "Modo claro" : "Modo oscuro"}</span>
          </button>

          <div className="border-t border-border my-1" />

          {loading ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">Cargando…</div>
          ) : user ? (
            <>
              <Link
                href="/perfil"
                className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>👤</span> Mi perfil
              </Link>
              <Link
                href="/mis-pedidos"
                className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>📦</span> Mis pedidos
              </Link>
              <Link
                href="/favoritos"
                className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>❤️</span> Mis favoritos
              </Link>
              {staff ? (
                <Link
                  href="/vendor/dashboard"
                  className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  <span>🛵</span> Mi reparto
                </Link>
              ) : (
                <Link
                  href="/vendor/dashboard"
                  className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                  onClick={() => setMenuOpen(false)}
                >
                  <span>🏪</span> Mi comercio
                </Link>
              )}
              <Link
                href="/planes"
                className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>💳</span> Planes
              </Link>
              {isAdmin && (
                <>
                  <div className="border-t border-border my-1" />
                  <Link
                    href="/admin"
                    className="flex items-center gap-3 px-4 py-3 text-sm text-amber-600 font-medium hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Shield className="h-4 w-4" /> Panel Admin
                  </Link>
                </>
              )}
              <div className="border-t border-border my-1" />
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              >
                <span>🚪</span> Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>🔑</span> Iniciar sesión
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-3 px-4 py-3 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>🏪</span> Sumá tu comercio
              </Link>
              <Link
                href="/vincular"
                className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <span>🛵</span> Unirme como repartidor
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}