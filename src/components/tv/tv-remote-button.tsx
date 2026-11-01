"use client";

import { useState } from "react";

type Props = {
  /** Token de la pantalla destino. */
  token: string;
  /** ¿La tele está conectada ahora mismo? */
  connected: boolean;
};

/**
 * Botón "Enviar a la tele" (mando a distancia).
 *
 * El celular le pide al server que le mande el comando a la tele; el SSE de
 * la pantalla lo empuja y el reproductor cambia solo de carta (≤5s).
 *
 * Vive en la página /tv/<token> (la que se abre al escanear el QR) y también
 * en el panel del comercio.
 */
export function TvRemoteButton({ token, connected }: Props) {
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setMsg(null);
    setError(null);
    try {
      const r = await fetch(`/api/pantalla/${token}/remote`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j?.error || "No se pudo enviar el comando.");
        return;
      }
      setMsg(j?.message || "Enviado a la tele.");
    } catch {
      setError("Sin conexión con el servidor.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={send}
        disabled={sending}
        className="w-full rounded-2xl bg-primary px-5 py-4 text-base font-bold text-primary-foreground shadow-sm transition disabled:opacity-60"
      >
        {sending ? "Enviando…" : "📺 Enviar a la tele"}
      </button>
      {msg && !error && (
        <p className="mt-2 rounded-xl bg-green-50 px-3 py-2 text-center text-sm font-semibold text-green-700">
          ✓ {msg}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-center text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
      {!connected && !msg && !error && (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Ahora mismo la tele no está conectada. El comando queda esperando y se aplica apenas
          se abra el link.
        </p>
      )}
    </div>
  );
}
