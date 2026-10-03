"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BookingFormState } from "@/lib/customer-forms";

/**
 * Banner en /turno/[token]: la clienta completa su ficha antes de venir.
 * Crea (o reutiliza) el borrador atado al turno y redirige a /ficha/[token].
 */
export function TurnoFichaBanner({
  bookingToken,
  templates,
}: {
  bookingToken: string;
  templates: BookingFormState[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function start(templateId: string, existingToken: string | null) {
    if (existingToken) {
      window.location.href = `/ficha/${existingToken}`;
      return;
    }
    setBusy(templateId);
    setMsg("");
    try {
      const res = await fetch("/api/ficha/by-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_token: bookingToken, template_id: templateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.url) {
        setMsg(data.error || "No se pudo abrir la ficha");
        return;
      }
      window.location.href = data.url;
    } catch {
      setMsg("Error de conexión");
    } finally {
      setBusy(null);
    }
  }

  const pending = templates.filter((t) => t.entry_status !== "complete");

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left space-y-2">
      <p className="text-sm font-semibold text-violet-900">📋 Tu ficha</p>
      {pending.length === 0 ? (
        <p className="text-xs text-violet-800">✅ Ficha completa. ¡Gracias!</p>
      ) : (
        <>
          <p className="text-xs text-violet-800">
            Completá tu ficha antes de venir para agilizar tu atención.
          </p>
          {pending.map((t) => (
            <Button
              key={t.id}
              size="sm"
              className="w-full"
              disabled={busy !== null}
              onClick={() => start(t.id, t.public_token)}
            >
              {busy === t.id
                ? "Abriendo..."
                : t.entry_status === "draft"
                  ? `Continuar: ${t.name}`
                  : `${t.require_before ? "Completar (requerida): " : "Completar: "}${t.name}`}
            </Button>
          ))}
        </>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}
