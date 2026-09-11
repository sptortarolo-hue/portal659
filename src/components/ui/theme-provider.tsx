"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "portal659-theme-v2";
// Breakpoint desktop (lg de Tailwind): a partir de acá el default es oscuro.
const DESKTOP_QUERY = "(min-width: 1024px)";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolved: "light" | "dark";
}>({
  theme: "system",
  setTheme: () => {},
  resolved: "light",
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Default por viewport: desktop oscuro, mobile claro. */
function getViewportTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DESKTOP_QUERY).matches ? "dark" : "light";
}

function getStored(): Theme | null {
  try {
    return localStorage.getItem(STORAGE_KEY) as Theme | null;
  } catch {
    return null;
  }
}

function applyResolved(r: "light" | "dark") {
  if (r === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Elección explícita guardada gana; si no hay, default por viewport.
    const initial = getStored() ?? getViewportTheme();
    setThemeState(initial);
    const r = initial === "system" ? getSystemTheme() : initial;
    setResolved(r);
    applyResolved(r);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const r = theme === "system" ? getSystemTheme() : theme;
    setResolved(r);
    applyResolved(r);
  }, [theme, mounted]);

  // Mientras no haya elección explícita, el tema sigue al viewport
  // (rotar tablet, redimensionar ventana, devtools mobile/desktop).
  useEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onViewport = () => {
      if (!getStored()) {
        setThemeState(getViewportTheme());
      }
    };
    mq.addEventListener("change", onViewport);
    return () => mq.removeEventListener("change", onViewport);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const next = getSystemTheme();
        setResolved(next);
        applyResolved(next);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, mounted]);

  function setTheme(t: Theme) {
    // Solo la elección explícita del usuario se persiste.
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* noop */
    }
    setThemeState(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
