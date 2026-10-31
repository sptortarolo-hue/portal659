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
  /** Ajustar al contenedor padre (preview del panel) en vez de a la ventana. */
  fitParent?: boolean;
};

/**
 * Lienzo fijo de 1920×1080 escalado al viewport del TV.
 *
 * Diseñar a resolución fija (en vez de "responsive") es lo que hace que un
 * menú en TV se vea compuesto: el layout se prueba a 1080p y se escala exacto
 * en cualquier pantalla, sin sorpresas de tamaño de texto ni de reflow.
 */
export function TvCanvas({ children, theme, debug = false, offline = false, fitParent = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      const s = scaleForViewport(host.clientWidth, host.clientHeight);
      setScale(s > 0 ? s : 0.1);
    };
    // requestAnimationFrame asegura que el layout ya se calculó (el parent
    // con aspectRatio puede tener 0x0 en el primer frame).
    const raf = requestAnimationFrame(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    window.addEventListener("orientationchange", fit);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("orientationchange", fit);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`relative overflow-hidden bg-black ${fitParent ? "h-full w-full" : "h-screen w-screen"}`}
      style={{ cursor: "none" }}
    >
      {/* Keyframes del reproductor: viven acá (y no en el layout de la ruta)
          para que el preview del panel se vea EXACTAMENTE igual que la TV. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@keyframes tv-progress { from { width: 0% } to { width: 100% } }
@keyframes tv-breathe { 0%, 100% { opacity: .62 } 50% { opacity: 1 } }
@keyframes tv-fade-in { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
@keyframes tv-slide-in { from { opacity: 0; transform: translateX(-26px) scale(.985) } to { opacity: 1; transform: none } }
@keyframes tv-pop { 0% { opacity: 0; transform: scale(.94) translateY(10px) } 60% { transform: scale(1.015) translateY(0) } 100% { opacity: 1; transform: scale(1) } }
@keyframes tv-kenburns { from { transform: scale(1.02) translate3d(0,0,0) } to { transform: scale(1.14) translate3d(-1.5%, -1%, 0) } }
@keyframes tv-marquee { from { transform: translateX(0) } to { transform: translateX(-50%) } }
@keyframes tv-glow-pulse { 0%, 100% { opacity: .55; transform: scale(1) } 50% { opacity: 1; transform: scale(1.06) } }
@keyframes tv-shimmer { 0% { transform: translateX(-120%) } 100% { transform: translateX(320%) } }
@keyframes tv-price-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.tv-slide-enter { animation: tv-slide-in 520ms cubic-bezier(.22,.8,.28,1) both; }
.tv-item-enter { animation: tv-pop 460ms cubic-bezier(.22,.9,.3,1) both; }
.tv-kenburns { animation: tv-kenburns 18s ease-out both; }
.tv-marquee-track { animation: tv-marquee 26s linear infinite; }
.tv-glow-pulse { animation: tv-glow-pulse 3.4s ease-in-out infinite; }
.tv-price-in { animation: tv-price-in 420ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .tv-slide-enter, .tv-item-enter, .tv-kenburns, .tv-marquee-track, .tv-glow-pulse, .tv-price-in,
  [style*="tv-breathe"], [style*="tv-progress"] { animation: none !important; }
}
`,
        }}
      />
      <div
        className="absolute left-1/2 top-1/2 origin-center"
        style={{
          width: TV_CANVAS.w,
          height: TV_CANVAS.h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          ...(themeVars(theme) as React.CSSProperties),
          background: "var(--tv-bg-grad)",
          backgroundColor: "var(--tv-bg)",
          color: "var(--tv-fg)",
          fontFamily: "inherit",
        }}
      >
        {/* Viñeta + grano sutil: le da "profundidad" al lienzo sin ruido visual. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 50% 40%, transparent 55%, rgba(0,0,0,0.16) 100%)",
          }}
        />
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
