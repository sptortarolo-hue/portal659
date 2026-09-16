"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Cuando el link llega con ?menu=1, scrollea suavemente hasta la sección "Menú"
 * dejándola justo debajo del nav superior (offset ~104px en mobile, ~64 en desktop).
 */
export function ScrollToMenu() {
  const params = useSearchParams();

  useEffect(() => {
    // ?from=qr (link escaneado desde un QR impreso) se comporta como ?menu=1.
    if (params.get("menu") !== "1" && params.get("from") !== "qr") return;
    // Si hay oferta puntual o categoría puntual, ese scrollea lo maneja otro componente.
    if (params.get("oferta") || params.get("cat")) return;
    const id = window.setTimeout(() => {
      const el = document.getElementById("menu");
      if (!el) return;
      const isMobile = window.innerWidth < 640;
      // 152 = nav (104) + barra de marca (48); desktop nav = 64.
      const offset = isMobile ? 152 : 64;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }, 200);
    return () => window.clearTimeout(id);
  }, [params]);

  return null;
}