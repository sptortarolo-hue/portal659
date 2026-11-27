"use client";

import { useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Botón "Descargar app" (PWA).
 * - Si la web corre dentro de la app instalada (display-mode: standalone) o ya
 *   se instaló, el botón no se muestra.
 * - Android/desktop Chrome: dispara el prompt de instalación nativo.
 * - iOS Safari / sin soporte: muestra un modal con instrucciones
 *   ("Agregar a pantalla de inicio").
 */
export function InstallAppButton() {
  const [isInstalled, setIsInstalled] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const detectStandalone = () => {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (standalone) setIsInstalled(true);
    };
    detectStandalone();

    const onInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (mountedRef.current) setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      if (mountedRef.current) setIsInstalled(true);
    };
    const onAppInstalled = () => {
      if (mountedRef.current) setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    // iOS: sin evento; se detecta por standalone o por la visibilidad.
    window.addEventListener("resize", detectStandalone);

    return () => {
      mountedRef.current = false;
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("resize", detectStandalone);
    };
  }, []);

  if (isInstalled) return null;

  async function handleClick() {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") setIsInstalled(true);
      setDeferredPrompt(null);
      return;
    }
    // iOS / navegadores sin beforeinstallprompt: instrucciones.
    setShowHelp(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 transition-colors"
        title="Instalar la app de Portal 659 en tu dispositivo"
      >
        <Smartphone className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        Descargar app
      </button>

      {showHelp && (
        <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
          <div className="bg-card rounded-2xl p-6 max-w-sm w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="pv2-section-icon mx-auto mb-3 h-14 w-14">
              <Smartphone className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
            </div>
            <h3 className="font-display text-lg font-semibold mb-1">Instalá la app</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Abrí el menú del navegador y tocá <strong>"Agregar a pantalla de inicio"</strong>. La app queda en tu celular para pedir más rápido.
            </p>
            <button
              onClick={() => setShowHelp(false)}
              className="w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium py-2.5 hover:bg-primary/90 transition-colors"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}