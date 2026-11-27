"use client";

import { useEffect } from "react";

/**
 * Guardia de salida para la home de la PWA/TWA.
 * En Android, el botón "Atrás" en la home cierra la app sin confirmación.
 * Este componente intercepta la navegación hacia atrás y muestra un
 * diálogo de confirmación para evitar salidas accidentales.
 */
export function BackButtonGuard() {
  useEffect(() => {
    // Empujar un estado extra para poder interceptar el back
    window.history.pushState({ backButtonGuard: true }, "");

    const onPopState = () => {
      // Los links internos con #ancla (Oferta de hoy, Lo más pedido, etc.)
      // generan un popstate de mismo documento. No es una salida: no
      // confirmamos ni re-empujamos estado, para no trabar el botón Atrás.
      if (window.location.hash) return;

      const ok = window.confirm("¿Querés salir de la app?");
      if (ok) {
        // Permitir la salida: no re-empujar estado
        // El navegador ya hizo el pop, así que la app se cierra
      } else {
        // Cancelar la salida: re-empujar el estado para mantener la app abierta
        window.history.pushState({ backButtonGuard: true }, "");
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return null;
}
