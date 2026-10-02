"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DELIVERY_PAUSE_REASONS,
  extraCoveringNow,
  isDeliveryOpen,
  isDeliveryPaused,
  listActiveExtras,
  scheduleTextForISO,
  shiftMinutesForISO,
} from "@/lib/delivery-schedule";
import type { Vendor } from "@/types/database";

/**
 * Toggle de reparto (header del dashboard, solo retail con delivery).
 * Espejo del OpenToggle pero para el REPARTO, con identidad propia (🛵 +
 * amber/violet en vez del punto verde/rojo del local):
 *  - pausar con timer (30/60/120 min / hoy) + mensaje opcional al cliente
 *  - horario especial por día (extender o agregar: Hoy/Mañana/+7)
 *  - forzar abierto / volver a según horario
 *
 * La pausa es BLANDA: el pedido sigue entrando con el próximo turno.
 */
export function DeliveryToggle({ vendor, onSaved }: { vendor: Vendor; onSaved: (v: Vendor) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // Pausa
  const [pauseDur, setPauseDur] = useState<number | "hoy">(60);
  const [pauseMsg, setPauseMsg] = useState<string>("");
  // Día especial
  const [extraDate, setExtraDate] = useState<string>(() => todayISOAR());
  const [extraOpen, setExtraOpen] = useState("09:00");
  const [extraClose, setExtraClose] = useState("20:00");

  // Refresca la cuenta regresiva de la pill cada 30s.
  useEffect(() => {
    if (!modalOpen) {
      const t = setInterval(() => setNow(Date.now()), 30000);
      return () => clearInterval(t);
    }
  }, [modalOpen]);

  const sched = {
    hours: vendor.hours ?? null,
    delivery_hours: (vendor as any).delivery_hours ?? null,
    open_override: vendor.open_override ?? null,
    delivery_override: (vendor as any).delivery_override ?? null,
    delivery_paused_until: (vendor as any).delivery_paused_until ?? null,
    delivery_pause_reason: (vendor as any).delivery_pause_reason ?? null,
    delivery_extra_days: (vendor as any).delivery_extra_days ?? null,
  };

  const paused = isDeliveryPaused(sched, { at: new Date(now) });
  const forced = !paused && sched.delivery_override === true;
  const resolvedOpen = isDeliveryOpen(sched);
  const covering = !paused && !forced ? extraCoveringNow(sched) : null;
  const extras = useMemo(() => listActiveExtras(sched), [JSON.stringify(sched.delivery_extra_days)]);
  const dayOptions = useMemo(() => next8DaysAR(), []);

  // Prefill del editor de día especial al cambiar fecha/disponibilidad.
  useEffect(() => {
    if (!modalOpen) return;
    const cur = ((vendor as any).delivery_extra_days || {})[extraDate];
    if (cur && (cur.open || cur.close)) {
      if (cur.open) setExtraOpen(String(cur.open).slice(0, 5));
      if (cur.close) setExtraClose(String(cur.close).slice(0, 5));
      return;
    }
    const base = shiftMinutesForISO(sched, extraDate);
    if (base) {
      setExtraOpen(base.open);
      setExtraClose(base.close);
    }
  }, [modalOpen, extraDate]);

  async function post(data: Record<string, unknown>): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const j = await res.json().catch(() => null);
      if (j?.vendor) {
        onSaved(j.vendor);
        return true;
      }
      setErr(j?.error || "No se pudo guardar. ¿Aplicaste la migración de franjas?");
      return false;
    } catch {
      setErr("Error de red");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function pausedUntilISO(): string {
    if (pauseDur === "hoy") {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      return d.toISOString();
    }
    return new Date(Date.now() + Number(pauseDur) * 60000).toISOString();
  }

  async function savePause() {
    const ok = await post({
      delivery_override: false,
      delivery_paused_until: pausedUntilISO(),
      delivery_pause_reason: pauseMsg || null,
    });
    if (ok) setModalOpen(false);
  }

  async function saveResume() {
    const ok = await post({ delivery_override: null, delivery_paused_until: null, delivery_pause_reason: null });
    if (ok) setModalOpen(false);
  }

  async function saveForceOpen() {
    const ok = await post({ delivery_override: true, delivery_paused_until: null, delivery_pause_reason: null });
    if (ok) setModalOpen(false);
  }

  async function saveExtra() {
    const cur = { ...(((vendor as any).delivery_extra_days || {}) as Record<string, unknown>) };
    cur[extraDate] = { open: extraOpen, close: extraClose };
    const ok = await post({ delivery_extra_days: cur });
    if (ok) setModalOpen(false);
  }

  async function deleteExtra(iso: string) {
    const cur = { ...(((vendor as any).delivery_extra_days || {}) as Record<string, unknown>) };
    delete cur[iso];
    await post({ delivery_extra_days: cur });
  }

  // ---- Pill ----
  let pillClass = "border-border text-muted-foreground";
  let pillLabel = `🛵 Reparto ${resolvedOpen === true ? "abierto" : resolvedOpen === false ? "cerrado" : "—"}`;
  if (paused) {
    pillClass = "border-amber-300 text-amber-700 dark:text-amber-400";
    const until = ((vendor as any).delivery_paused_until || "").trim();
    pillLabel = until ? `⏸️ Pausado · ${remainingLabel(until, now)}` : "⏸️ Pausado";
  } else if (forced) {
    pillClass = "border-primary text-primary";
    pillLabel = "🛵 Forzado abierto";
  } else if (covering) {
    pillClass = "border-violet-300 text-violet-700 dark:text-violet-400";
    pillLabel = `🛵 Hoy hasta ${covering.close}`;
  } else if (extras.length > 0) {
    pillClass = "border-violet-300 text-violet-700 dark:text-violet-400";
    pillLabel = `🛵 +${extras.length} día${extras.length > 1 ? "s" : ""} especial`;
  }

  const selectedSchedule = scheduleTextForISO(sched, extraDate);
  const selectedExtra = ((vendor as any).delivery_extra_days || {})[extraDate];

  return (
    <>
      <button
        type="button"
        onClick={() => { setErr(""); setExtraDate(todayISOAR()); setModalOpen(true); }}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors flex-shrink-0 ${pillClass}`}
        title={paused ? "Reparto en pausa. Tocá para gestionar." : "Reparto según horario. Tocá para pausar o agregar horario."}
      >
        {saving ? "Guardando..." : pillLabel}
      </button>

      {modalOpen && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          onClick={() => !saving && setModalOpen(false)}
        >
          <div
            className="bg-card rounded-2xl p-5 w-full max-w-sm space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-base font-semibold">🛵 Reparto a domicilio</h3>
            {paused ? (
              <p className="text-sm text-muted-foreground">
                En pausa{(() => { const u = ((vendor as any).delivery_paused_until || "").trim(); return u ? ` · vuelve ${remainingLabel(u, now)}` : " · hasta reanudar"; })()}.
                Los pedidos siguen entrando para el próximo turno.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {resolvedOpen === true ? "Abierto ahora según horario." : resolvedOpen === false ? "Cerrado ahora según horario." : "Sin horario de reparto."}{" "}
                La pausa es blanda: el pedido entra igual para el próximo turno.
              </p>
            )}

            {/* Pausar */}
            <div className="space-y-2 rounded-xl border border-border p-3">
              <Label>⏸️ Pausar reparto</Label>
              <div className="flex flex-wrap gap-1.5">
                {([30, 60, 120] as number[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPauseDur(m)}
                    className={`rounded-lg py-1.5 px-2.5 text-xs font-medium border transition-colors ${
                      pauseDur === m ? "border-amber-400 bg-amber-50 text-amber-700" : "border-border text-muted-foreground"
                    }`}
                  >
                    {m >= 60 ? `${m / 60} h` : `${m} min`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPauseDur("hoy")}
                  className={`rounded-lg py-1.5 px-2.5 text-xs font-medium border transition-colors ${
                    pauseDur === "hoy" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-border text-muted-foreground"
                  }`}
                >
                  Hoy (23:59)
                </button>
              </div>
              <div>
                <Label className="text-xs">Mensaje al cliente (opcional)</Label>
                <select
                  value={pauseMsg}
                  onChange={(e) => setPauseMsg(e.target.value)}
                  className="mt-1 w-full h-10 px-2 text-sm rounded-xl border border-input bg-background"
                >
                  <option value="">Sin mensaje</option>
                  {Object.entries(DELIVERY_PAUSE_REASONS).map(([code, r]) => (
                    <option key={code} value={code}>{r.label} — “{r.clientMsg}”</option>
                  ))}
                </select>
              </div>
              <Button type="button" size="sm" className="w-full" disabled={saving} onClick={savePause}>
                {saving ? "Guardando…" : paused ? "Actualizar pausa" : "Pausar reparto"}
              </Button>
            </div>

            {/* Día especial */}
            <div className="space-y-2 rounded-xl border border-border p-3">
              <Label>📅 Horario especial (extender o agregar)</Label>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {dayOptions.map((d) => (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => setExtraDate(d.iso)}
                    className={`rounded-lg py-1.5 px-2 text-xs font-medium border transition-colors flex-shrink-0 ${
                      extraDate === d.iso ? "border-violet-400 bg-violet-50 text-violet-700" : "border-border text-muted-foreground"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedSchedule ? `Horario actual: ${selectedSchedule}` : "Ese día no hay reparto."}{" "}
                {selectedExtra ? "(ya tiene día especial: se reemplaza)" : ""}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs" htmlFor="extra-open">Desde</Label>
                  <Input id="extra-open" type="time" value={extraOpen} onChange={(e) => setExtraOpen(e.target.value)} className="mt-1 h-10 text-sm" />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="extra-close">Hasta</Label>
                  <Input id="extra-close" type="time" value={extraClose} onChange={(e) => setExtraClose(e.target.value)} className="mt-1 h-10 text-sm" />
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" className="w-full" disabled={saving} onClick={saveExtra}>
                Guardar día especial
              </Button>
              {extras.length > 0 && (
                <div className="space-y-1 pt-1">
                  {extras.map((x) => (
                    <div key={x.iso} className="flex items-center justify-between rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs">
                      <span className="font-medium">📅 {x.label}</span>
                      <button
                        type="button"
                        onClick={() => deleteExtra(x.iso)}
                        disabled={saving}
                        className="text-muted-foreground hover:text-red-600 px-1"
                        title="Quitar día especial"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Forzar / volver */}
            <div className="space-y-2">
              {!forced && (
                <Button type="button" variant="outline" className="w-full justify-start" onClick={saveForceOpen} disabled={saving}>
                  🛵 Forzar reparto abierto
                </Button>
              )}
              {(paused || forced) && (
                <Button type="button" variant="outline" className="w-full justify-start" onClick={saveResume} disabled={saving}>
                  ↩️ Volver a según horario
                </Button>
              )}
            </div>

            {err && <p className="text-xs text-red-500">{err}</p>}

            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setModalOpen(false)} disabled={saving}>
              Cerrar
            </Button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/** "Hoy"/"Mañana"/"sáb 4/10" para los próximos 8 días (TZ del dispositivo). */
function next8DaysAR(): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  const now = new Date();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = add === 0 ? "Hoy" : add === 1 ? "Mañana" : d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" });
    out.push({ iso, label });
  }
  return out;
}

function todayISOAR(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "45 min" / "1 h 20" / "hasta 23:59" para la pill. */
function remainingLabel(untilISO: string, nowMs: number): string {
  const end = new Date(untilISO).getTime();
  if (Number.isNaN(end)) return "";
  const diff = Math.max(0, end - nowMs);
  const mins = Math.round(diff / 60000);
  if (mins <= 0) return "ya vuelve";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 5) {
    const d = new Date(end);
    return `hasta las ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}
