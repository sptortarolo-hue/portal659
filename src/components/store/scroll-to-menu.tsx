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
    if (params.get("menu") !== "1") return;
    const id = window.setTimeout(() => {
      const el = document.getElementById("menu");
      if (!el) return;
      const isMobile = window.innerWidth < 640;
      const offset = isMobile ? 104 : 64;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }, 200);
    return () => window.clearTimeout(id);
  }, [params]);

  return null;
}