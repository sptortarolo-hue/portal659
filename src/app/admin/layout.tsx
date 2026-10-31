"use client";

import { useState, useEffect, useCallback } from "react";
import AdminGuard from "@/components/admin/admin-guard";
import AdminSidebar from "@/components/admin/admin-sidebar";
import AdminBottomNav from "@/components/admin/admin-bottom-nav";
import { Menu, X } from "lucide-react";
import Link from "next/link";

// El HTML del admin no debe cachearse (ni Next ni CDN): referencia hashes de
// chunks que rotan en cada deploy; un HTML viejo = ChunkLoadError permanente.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Modo riel (desktop): sidebar de 76px con íconos + etiqueta mini.
  const [rail, setRail] = useState(true);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("portal659-sidebar-rail");
      if (saved === "0") setRail(false);
      if (saved === "1") setRail(true);
    } catch { /* storage bloqueado: default riel */ }
  }, []);
  const toggleRail = useCallback(() => {
    setRail((v) => {
      const next = !v;
      try { window.localStorage.setItem("portal659-sidebar-rail", next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  }, []);

  return (
    <AdminGuard>
      <div className="ts-ui min-h-screen bg-background flex">
        <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} rail={rail} onToggleRail={toggleRail} />

        <div className={`flex-1 flex flex-col min-h-screen min-w-0 ${rail ? "lg:ml-[76px]" : "lg:ml-64"}`}>
          {/* Barra superior: la identidad ("Panel Admin") es el primer
              elemento a la izquierda, antes en la cabecera de la sidebar. */}
          <header className="sticky top-14 sm:top-0 z-30 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-lg hover:bg-muted transition-colors lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <Link href="/admin" className="font-display text-base sm:text-lg font-semibold truncate">
              Panel Admin
            </Link>
            <div className="flex-1" />
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              Volver al sitio
            </Link>
          </header>

          <main className="flex-1 p-4 lg:p-6 pb-24 lg:pb-6">
            {children}
          </main>
        </div>

        <AdminBottomNav />
      </div>
    </AdminGuard>
  );
}
