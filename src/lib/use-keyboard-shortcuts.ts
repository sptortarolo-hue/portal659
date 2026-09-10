"use client";

import { useEffect, useCallback } from "react";

type Tab = "config" | "menu" | "orders" | "history" | "comanda" | "analytics" | "pos" | "mesas" | "reviews";

const SHORTCUTS: { key: string; ctrl?: boolean; tab: Tab; label: string }[] = [
  { key: "1", ctrl: true, tab: "orders", label: "Pedidos" },
  { key: "2", ctrl: true, tab: "comanda", label: "Comanda" },
  { key: "3", ctrl: true, tab: "pos", label: "Mostrador" },
  { key: "4", ctrl: true, tab: "mesas", label: "Mesas" },
  { key: "5", ctrl: true, tab: "menu", label: "Menú" },
  { key: "6", ctrl: true, tab: "config", label: "Configuración" },
  { key: "7", ctrl: true, tab: "analytics", label: "Estadísticas" },
  { key: "8", ctrl: true, tab: "history", label: "Histórico" },
  { key: "9", ctrl: true, tab: "reviews", label: "Reseñas" },
];

/**
 * Hook global de shortcuts de teclado para el dashboard del vendor.
 * Ctrl+1-9 cambia de tab. Escape cierra modales. / focusa el buscador.
 */
export function useKeyboardShortcuts({
  onTabChange,
  onEscape,
  enabled = true,
}: {
  onTabChange: (tab: Tab) => void;
  onEscape?: () => void;
  enabled?: boolean;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Ignore when typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ctrl+number → switch tab
      if (e.ctrlKey || e.metaKey) {
        const shortcut = SHORTCUTS.find((s) => s.key === e.key && s.ctrl);
        if (shortcut) {
          e.preventDefault();
          onTabChange(shortcut.tab);
          return;
        }
      }

      // Escape → close modal
      if (e.key === "Escape" && onEscape) {
        onEscape();
        return;
      }

      // / → focus search (dispatch a custom event)
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("portal:focus-search"));
      }
    },
    [enabled, onTabChange, onEscape]
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}
