"use client";

import { useEffect } from "react";
import { useTheme } from "@/components/ui/theme-provider";

const LIGHT_BAR = "#ffffff";
const DARK_BAR = "#000000";
const LIGHT_BG = "#ffffff";
const DARK_BG = "#0f1117";

/**
 * Sincroniza los <meta name="theme-color"> con el modo resuelto: las barras
 * del sistema quedan del color del modo (negro en oscuro, blanco en claro)
 * y el fondo del <html> mimetizado con el contenido. Chrome/WebView/TWA usa
 * theme-color para las barras: si queda clavado en otro color, las
 * transiciones parpadean (blanco/negro en oscuro).
 */
export function ThemeColorSync() {
  const { resolved } = useTheme();

  useEffect(() => {
    const bar = resolved === "dark" ? DARK_BAR : LIGHT_BAR;
    const bg = resolved === "dark" ? DARK_BG : LIGHT_BG;
    const metas = document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]'
    );
    if (metas.length === 0) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = bar;
      document.head.appendChild(meta);
    } else {
      metas.forEach((meta) => {
        meta.content = bar;
      });
    }
    // Mantiene el fondo inline que fija el script pre-paint del <head>.
    document.documentElement.style.backgroundColor = bg;
  }, [resolved]);

  return null;
}
