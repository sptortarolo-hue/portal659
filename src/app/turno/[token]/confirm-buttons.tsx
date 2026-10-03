"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Botones públicos Confirmar / Cancelar turno (sin cuenta). */
export function TurnoConfirmButtons({
  token,
  initialStatus,
  cancelHours,
  cancelPolicy,
}: {
  token: string;
  initialStatus: string;
  cancelHours: number;
  cancelPolicy: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [msg, setMsg] = useState("");
  const [late, setLate] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  async function act(action: "confirm" | "cancel") {
    setBusy(action);
    setMsg("");
    try {
      const res = await fetch("/api/bookings/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.ok) {
        setMsg(typeof data.error === "string" ? data.error : "No se pudo procesar");
        return;
      }
      setStatus(data.status);
      setLate(data.late === true);
    } catch {
      setMsg("Error de conexión");
    } finally {
      setBusy(null);
      setConfirmingCancel(false);
    }
  }

  if (status === "confirmed") {
    return (
      <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
        <p className="font-semibold text-green-800 text-sm">✅ Turno confirmado</p>
        <p className="text-xs text-green-700 mt-1">Te esperamos. Si surge algo, podés cancelarlo desde este mismo link.</p>
        <button
          type="button"
          onClick={() => setConfirmingCancel(true)}
          className="text-xs text-green-700 underline mt-2"
        >
          Cancelar el turno
        </button>
        {confirmingCancel && (
          <div className="mt-2 space-y-2">
            {cancelPolicy && <p className="text-xs text-green-800">📝 {cancelPolicy}</p>}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfirmingCancel(false)}>
                Volver
              </Button>
              <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600" disabled={busy === "cancel"} onClick={() => act("cancel")}>
                {busy === "cancel" ? "Cancelando..." : "Sí, cancelar"}
              </Button>
            </div>
          </div>
        )}
        {msg && <p className="text-xs text-red-600 mt-2">{msg}</p>}
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="rounded-xl bg-muted border border-border px-4 py-3">
        <p className="font-semibold text-sm">Turno cancelado</p>
        {late && <p className="text-xs text-muted-foreground mt-1">Se canceló dentro del plazo ({cancelHours} h): consultá por tu seña.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button className="w-full" disabled={busy !== null} onClick={() => act("confirm")}>
        {busy === "confirm" ? "Confirmando..." : "✅ Confirmar mi turno"}
      </Button>
      {!confirmingCancel ? (
        <Button variant="outline" className="w-full text-red-600" disabled={busy !== null} onClick={() => setConfirmingCancel(true)}>
          Cancelar el turno
        </Button>
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 space-y-2">
          <p className="text-xs text-red-800 font-medium">¿Segura/o? Esta acción avisa al local.</p>
          {cancelPolicy && <p className="text-xs text-red-700">📝 {cancelPolicy}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setConfirmingCancel(false)}>
              Volver
            </Button>
            <Button size="sm" className="flex-1 bg-red-500 hover:bg-red-600" disabled={busy === "cancel"} onClick={() => act("cancel")}>
              {busy === "cancel" ? "Cancelando..." : "Sí, cancelar"}
            </Button>
          </div>
        </div>
      )}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}
