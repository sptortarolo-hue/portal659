"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/nav/theme-toggle";

export function UserMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex items-center gap-1" ref={menuRef}>
      <ThemeToggle />
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-muted hover:bg-primary/10 transition-colors text-lg"
          aria-label="Menú"
        >
          ☰
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border rounded-xl shadow-lg py-2 z-50 animate-fade-in-up">
            <Link
              href="/mis-pedidos"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <span>📦</span> Mis pedidos
            </Link>
            <Link
              href="/vendor/dashboard"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <span>🏪</span> Mi cuenta
            </Link>
            <Link
              href="/login"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <span>🔑</span> Iniciar sesión
            </Link>
            <div className="border-t border-border my-1" />
            <Link
              href="/register"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-primary font-medium hover:bg-primary/10 transition-colors"
              onClick={() => setMenuOpen(false)}
            >
              <span>🏪</span> Sumá tu comercio
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
