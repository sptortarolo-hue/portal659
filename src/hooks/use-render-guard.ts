"use client";

import { useEffect, useRef } from "react";

/**
 * Guardia de renders infinitos (React #300 "Too many re-renders").
 * Cuenta renders en una ventana deslizante y, si un componente supera el
 * umbral, loguea el nombre + stack y reporta al servidor. En producción
 * React minifica los errores, así que esta telemetría es la única forma
 * de saber QUÉ componente está en loop.
 */
export function useRenderGuard(name: string, threshold = 60, windowMs = 2000) {
  const renders = useRef<number[]>([]);

  useEffect(() => {
    const now = Date.now();
    renders.current = renders.current.filter((t) => now - t < windowMs);
    renders.current.push(now);

    if (renders.current.length >= threshold) {
      const stack = new Error().stack || "";
      // Log local + telemetría (caen en docker logs como [API:client-error]).
      console.error(`[render-guard] ${name} supera ${threshold} renders en ${windowMs}ms`, stack);
      try {
        fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `render-guard: ${name} ${renders.current.length} renders/${windowMs}ms`,
            stack: stack.slice(0, 1500),
            pathname: typeof window !== "undefined" ? window.location.pathname : null,
          }),
        }).catch(() => {});
      } catch {
        /* noop */
      }
      // Reseta para no spamear en cada render siguiente.
      renders.current = [];
    }
  });
}
