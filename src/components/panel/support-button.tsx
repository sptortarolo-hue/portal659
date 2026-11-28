"use client";

/**
 * Botón de soporte dentro del panel (v1: mail + fallback de WhatsApp).
 *
 * Componente NUEVO, sin tabla ni estado global. Se monta apagado por defecto:
 * se habilita con `?support=1` en la URL o con
 * `localStorage.setItem("portal659-support-ui", "1")`. Si se borra el
 * componente y las dos líneas de los layouts, el panel queda idéntico.
 *
 * No es flotante: va en el header para no chocar con el botón rojo de Comanda
 * (z-70), la bottom-nav (z-50) ni los sheets del dashboard.
 */

import { useEffect, useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function SupportButton({ area }: { area: "vendor" | "admin" }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("support") === "1";
      const fromStorage = window.localStorage.getItem("portal659-support-ui") === "1";
      setEnabled(fromUrl || fromStorage);
    } catch {
      setEnabled(false);
    }
    const onOpen = () => setOpen(true);
    window.addEventListener("portal:open-support", onOpen);
    return () => window.removeEventListener("portal:open-support", onOpen);
  }, []);

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/vendor/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message, area }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setResult({ ok: false, text: data.error || "No se pudo enviar. Reintentá." });
      } else if (!data.emailed) {
        setResult({
          ok: true,
          text: "El mail no está configurado en este servidor. Escribinos por WhatsApp: https://wa.me/549112010898",
        });
      } else {
        setResult({ ok: true, text: "¡Listo! Te respondemos por email." });
        setMessage("");
        setSubject("");
      }
    } catch {
      setResult({ ok: false, text: "Sin conexión. Escribinos a soporte@portal659.com.ar" });
    }
    setSending(false);
  }

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Hablar con soporte"
        title="Hablar con soporte"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MessageCircleQuestion className="h-[18px] w-[18px]" />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Hablar con soporte"
        size="md"
        zIndex={80}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Contanos qué te pasa y te respondemos por email. Si es urgente,
            usá WhatsApp:{" "}
            <a
              href="https://wa.me/549112010898"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              22 1201 0898
            </a>
            .
          </p>
          <div>
            <label className="text-xs font-medium" htmlFor="support-subject">
              Asunto
            </label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ej: no puedo imprimir el ticket"
              className="mt-1"
              maxLength={120}
            />
          </div>
          <div>
            <label className="text-xs font-medium" htmlFor="support-message">
              Mensaje
            </label>
            <Textarea
              id="support-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describí lo que necesitás…"
              className="mt-1 min-h-32"
              maxLength={2000}
            />
          </div>
          {result && (
            <p
              className={`rounded-md px-3 py-2 text-sm ${
                result.ok
                  ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
              }`}
            >
              {result.text}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cerrar
            </Button>
            <Button
              type="button"
              onClick={send}
              disabled={sending || message.trim().length < 10}
            >
              {sending ? "Enviando…" : "Enviar"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
