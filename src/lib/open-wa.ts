/**
 * Abrir WhatsApp sin que el navegador lo bloquee como popup.
 *
 * El problema: si `window.open(...)` corre DESPUÉS de un `await` (cualquier
 * fetch al server), el "gesto del usuario" ya se consumió y Chrome/Safari lo
 * bloquean → apretás el botón y no pasa nada. Era el caso de "Avisar recibido /
 * Avisar confirmado" y de los avisos de presupuesto.
 *
 * El patrón: se abre una pestaña VACÍA sincrónicamente (dentro del gesto del
 * click) y recién cuando se conoce la URL real se le asigna la ubicación.
 */

/**
 * Abre una pestaña vacía en el gesto del click (debe llamarse SIN awaits
 * previos). Devuelve la ventana o null si el navegador la bloqueó.
 */
export function openWaWindowSync(): Window | null {
  if (typeof window === "undefined") return null;
  try {
    return window.open("", "_blank");
  } catch {
    return null;
  }
}

/**
 * Navega la ventana abierta a la URL real. Si la ventana no existe (bloqueada)
 * intenta el window.open común.
 */
export function navigateWaWindow(win: Window | null, url: string): boolean {
  if (win) {
    try {
      win.location.href = url;
      try {
        win.opener = null;
      } catch {
        /*noop*/
      }
      return true;
    } catch {
      /*caer al window.open*/
    }
  }
  try {
    return !!window.open(url, "_blank");
  } catch {
    return false;
  }
}

/** Cierra la pestaña vacía si no la usamos (enviado por el bot, error, etc.). */
export function closeWaWindow(win: Window | null): void {
  if (!win) return;
  try {
    win.close();
  } catch {
    /*noop*/
  }
}