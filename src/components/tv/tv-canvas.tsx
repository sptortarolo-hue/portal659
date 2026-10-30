"use client";

import { useEffect, useRef, useState } from "react";
import { themeVars } from "./tv-themes";
import { scaleForViewport, TV_CANVAS } from "@/lib/tv-layout";

type Props = {
  children: React.ReactNode;
  theme: Parameters<typeof themeVars>[0];
  /** Overlay guías (safe area, estado de conexión, versión) con ?debug=1. */
  debug?: boolean;
  /** Chip de "sin conexión" (el menú sigue saliendo desde la cache). */
  offline?: boolean;
};

/**
 * Lienzo fijo de 1920×1080 escalado al viewport del TV.
 *
 * Diseñar a resolución fija (en vez de "responsive") es lo que hace que un
 * menú en TV se vea compuesto: el layout se prueba a 1080p y se escala exacto
 * en cualquier pantalla, sin sorpresas de tamaño de texto ni de reflow.
 */
export function TvCanvas({ children, theme, debug = false, offline = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      setScale(scaleForViewport(host.clientWidth, host.clientHeight));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    window.addEventListener("orientationchange", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative h-screen w-screen overflow-hidden bg-black"
      style={{ cursor: "none" }}
    >
      <div
        className="absolute left-1/2 top-1/2 origin-center"
        style={{
          width: TV_CANVAS.w,
          height: TV_CANVAS.h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          ...(themeVars(theme) as React.CSSProperties),
          backgroundColor: "var(--tv-bg)",
          color: "var(--tv-fg)",
          fontFamily: "inherit",
        }}
      >
        {children}

        {debug && (
          <>
            <div
              className="pointer-events-none absolute border-2 border-dashed border-red-500/70"
              style={{
                left: TV_CANVAS.safeX,
                top: TV_CANVAS.safeY,
                width: TV_CANVAS.w - TV_CANVAS.safeX * 2,
                height: TV_CANVAS.h - TV_CANVAS.safeY * 2,
              }}
            />
            <div className="absolute right-6 top-2 rounded bg-black/80 px-3 py-1 text-[22px] text-white">
              safe area 1728×972 · {offline ? "sin conexión" : "en línea"}
            </div>
          </>
        )}
        {offline && !debug && (
          <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1 text-[22px] text-white">
            Sin conexión · mostrando la última carta
          </div>
        )}
      </div>
    </div>
  );
}
