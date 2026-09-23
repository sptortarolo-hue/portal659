"use client";

import { useEffect } from "react";
import { useTheme } from "@/components/ui/theme-provider";

const LIGHT_BG = "#ffffff";
const DARK_BG = "#0f1117";

/**
 * Sincroniza <meta name="theme-color"> con el fondo del tema resuelto.
 * Chrome/WebView/TWA usa theme-color para las barras del sistema: si queda
 * clavado en otro color, las transiciones parpadean (blanco/negro en oscuro).
 */
export function ThemeColorSync() {
  const { resolved } = useTheme();

  useEffect(() => {
    const color = resolved === "dark" ? DARK_BG : LIGHT_BG;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [resolved]);

  return null;
}
