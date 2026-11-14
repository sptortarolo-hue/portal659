"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { isImmersivePath } from "@/lib/immersive";

const STORAGE_KEY = "portal659_feedback_sent";
const SESSION_KEY = "portal659_feedback_shown";

/**
 * Botón flotante de feedback (👍/👎 + texto opcional).
 * Aparece una vez por sesión en rutas públicas. El tester puede enviar
 * feedback en 2 taps: elegir 👍/👎 y tocar "Enviar".
 * La respuesta se guarda en portal_events (analytics first-party) y
 * se ofrece enviar por WhatsApp o email para feedback detallado.
 */
export function MicroFeedback() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pathname?.startsWith("/vendor") || pathname?.startsWith("/admin")) return;
    if (isImmersivePath(pathname)) return;
    // No mostrar si ya envió feedback en esta sesión
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {}
    // Mostrar después de 30 segundos de uso (para que el tester explore primero)
    const timer = setTimeout(() => setVisible(true), 30_000);
    return () => clearTimeout(timer);
  }, [pathname]);

  const handleSend = useCallback(() => {
    // Guardar en analytics (best-effort)
    try {
      fetch("/api/track-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "feedback",
          rating: rating === "up" ? 1 : rating === "down" ? -1 : 0,
          text: text.slice(0, 500),
          path: pathname,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {}

    // Marcar como enviado en esta sesión
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}

    setSent(true);
    setTimeout(() => {
      setOpen(false);
      setVisible(false);
    }, 2000);
  }, [rating, text, pathname]);

  const handleWhatsApp = useCallback(() => {
    const msg = encodeURIComponent(
      `Feedback Portal 659:\n${rating === "up" ? "👍 Me gustó" : rating === "down" ? "👎 No me gustó" : ""}\n${text}`.trim()
    );
    window.open(`https://wa.me/5492212010898?text=${msg}`, "_blank");
    handleSend();
  }, [rating, text, handleSend]);

  if (!visible) return null;
  if (pathname?.startsWith("/vendor") || pathname?.startsWith("/admin")) return null;
  if (isImmersivePath(pathname)) return null;

  return (
    <>
      {/* Botón flotante */}
      {!open && !sent && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-24 sm:bottom-8 right-4 z-40 h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:shadow-xl hover:scale-105 transition-all text-lg"
          aria-label="Enviar feedback"
        >
          💬
        </button>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[90] bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5 animate-fade-in-up">
            {sent ? (
              <div className="text-center py-6">
                <div className="text-4xl mb-2">✅</div>
                <p className="font-medium">¡Gracias por tu feedback!</p>
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-base mb-3">¿Qué te pareció la app?</h3>
                <div className="flex gap-3 justify-center mb-4">
                  <button
                    onClick={() => setRating("up")}
                    className={`text-3xl p-2 rounded-xl transition-all ${
                      rating === "up" ? "bg-green-100 scale-110" : "hover:bg-muted"
                    }`}
                    aria-label="Me gustó"
                  >
                    👍
                  </button>
                  <button
                    onClick={() => setRating("down")}
                    className={`text-3xl p-2 rounded-xl transition-all ${
                      rating === "down" ? "bg-red-100 scale-110" : "hover:bg-muted"
                    }`}
                    aria-label="No me gustó"
                  >
                    👎
                  </button>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="¿Algo que mejorar? (opcional)"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  maxLength={500}
                />
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => { setOpen(false); setVisible(false); try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {} }}
                    className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-muted transition-colors"
                  >
                    Cerrar
                  </button>
                  <button
                    onClick={handleWhatsApp}
                    disabled={!rating && !text}
                    className="flex-1 rounded-xl bg-[#25D366] text-white py-2.5 text-sm font-semibold hover:bg-[#25D366]/90 transition-colors disabled:opacity-50"
                  >
                    Enviar por WhatsApp
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
