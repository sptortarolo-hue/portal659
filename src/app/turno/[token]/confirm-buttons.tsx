"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Botones públicos Confirmar / Cancelar / Reprogramar turno (sin cuenta). */
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
  const [busy, setBusy] = useState<"confirm" | "cancel" | "reschedule" | null>(null);
  const [msg, setMsg] = useState("");
  const [late, setLate] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [movedTo, setMovedTo] = useState("");

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

  async function reschedule() {
    if (!newDate || !newTime) {
      setMsg("Elegí fecha y hora nuevas");
      return;
    }
    setBusy("reschedule");
    setMsg("");
    try {
      const res = await fetch("/api/bookings/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action: "reschedule", bookingDate: newDate, bookingTime: newTime }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.ok) {
        setMsg(typeof data.error === "string" ? data.error : "No se pudo reprogramar");
        return;
      }
      setStatus(data.status);
      setMovedTo(`${data.bookingDate} a las ${String(data.bookingTime).slice(0, 5)}`);
      setRescheduling(false);
    } catch {
      setMsg("Error de conexión");
    } finally {
      setBusy(null);
    }
  }

  if (status === "confirmed") {
    return (
      <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
        <p className="font-semibold text-green-800 text-sm">✅ Turno confirmado</p>
        <p className="text-xs text-green-700 mt-1">Te esperamos. Si surge algo, podés reprogramarlo o cancelarlo desde este mismo link.</p>
        {movedTo && (
          <p className="text-xs font-medium text-green-800 mt-2 rounded-lg bg-white/60 border border-green-200 px-2 py-1.5">
            📅 Nuevo horario: {movedTo}
          </p>
        )}
        {!rescheduling ? (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setRescheduling(true)}
              className="flex-1 text-xs font-medium text-green-800 underline"
            >
              Cambiar fecha/hora
            </button>
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              className="flex-1 text-xs text-green-700 underline"
            >
              Cancelar el turno
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Nueva fecha"
              />
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                aria-label="Nueva hora"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setRescheduling(false)}>
                Volver
              </Button>
              <Button size="sm" className="flex-1" disabled={busy === "reschedule"} onClick={reschedule}>
                {busy === "reschedule" ? "Moviendo..." : "Confirmar cambio"}
              </Button>
            </div>
          </div>
        )}
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
      {!rescheduling ? (
        <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => setRescheduling(true)}>
          📅 Cambiar fecha/hora
        </Button>
      ) : (
        <div className="rounded-xl border border-border bg-card px-3 py-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Nueva fecha"
            />
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Nueva hora"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setRescheduling(false)}>
              Volver
            </Button>
            <Button size="sm" className="flex-1" disabled={busy === "reschedule"} onClick={reschedule}>
              {busy === "reschedule" ? "Moviendo..." : "Confirmar cambio"}
            </Button>
          </div>
        </div>
      )}
      {movedTo && (
        <p className="text-xs font-medium text-green-800 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
          📅 Nuevo horario: {movedTo}
        </p>
      )}
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
