"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "@/components/ui/theme-provider";
import { Shield } from "lucide-react";

export function UserMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme, setTheme, resolved } = useTheme();

  useEffect(() => {
    function checkAdmin() {
      fetch("/api/admin", { credentials: "include" })
        .then((r) => { if (r.ok) setIsAdmin(true); else setIsAdmin(false); })
        .catch(() => setIsAdmin(false));
    }
    checkAdmin();
    window.addEventListener("focus", checkAdmin);
    window.addEventListener("auth-changed", checkAdmin);
    return () => {
      window.removeEventListener("focus", checkAdmin);
      window.removeEventListener("auth-changed", checkAdmin);
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

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          setMenuOpen(!menuOpen);
          if (!menuOpen) {
            fetch("/api/admin", { credentials: "include" })
              .then((r) => { if (r.ok) setIsAdmin(true); })
              .catch(() => {});
          }
        }}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-muted hover:bg-primary/10 active:bg-primary/20 transition-colors text-lg"
        aria-label="Menú"
      >
        ☰
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
          <Link
            href="/mis-pedidos"
            className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            <span>📦</span> Mis pedidos
          </Link>
          <Link
            href="/vendor/dashboard"
            className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            <span>🏪</span> Mi cuenta
          </Link>
          <Link
            href="/login"
            className="flex items-center gap-3 px-4 py-3 text-sm text-foreground hover:bg-muted transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            <span>🔑</span> Iniciar sesión
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
          <Link
            href="/register"
            className="flex items-center gap-3 px-4 py-3 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            <span>🏪</span> Sumá tu comercio
          </Link>
        </div>
      )}
    </div>
  );
}
