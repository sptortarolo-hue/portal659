"use client";

import { useEffect, useState } from "react";

/**
 * Barra sticky del micrositio (solo mobile): aparece debajo del nav principal
 * en cuanto el "store header" (logo + nombre) sale del viewport. El selector
 * de categorías se sigue fijando debajo de esta barra (top-[104px]).
 */
export function StickyStoreBar({
  logoUrl,
  storeName,
}: {
  logoUrl: string | null;
  storeName: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = document.getElementById("store-header");
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // La barra aparece cuando el header de la tienda ya NO está en portaview.
        setVisible(!entries[0].isIntersecting);
      },
      // 56px = alto del nav principal (h-14): el umbral considera eso.
      { rootMargin: "-56px 0px 0px 0px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      className={[
        "fixed top-14 left-0 right-0 z-40 h-12 sm:hidden",
        "bg-background/95 backdrop-blur-sm border-b border-border",
        "flex items-center gap-2.5 px-4",
        "transition-transform duration-200 will-change-transform",
        visible ? "translate-y-0" : "-translate-y-[120%] pointer-events-none",
      ].join(" ")}
      aria-hidden={!visible}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`Logo de ${storeName}`}
          className="h-7 w-7 rounded-full object-cover border border-border flex-shrink-0"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
          <span className="font-bold text-xs text-primary">{storeName.charAt(0)}</span>
        </div>
      )}
      <span className="font-semibold text-sm truncate">{storeName}</span>
    </div>
  );
}