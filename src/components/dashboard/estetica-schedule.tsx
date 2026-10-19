"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DAY_LABEL,
  SLOT_STEP_MIN,
  WEEKDAY_ORDER,
  fmtMinutes,
  parseAvailability,
  shiftsFromHoursText,
  type Range,
} from "@/lib/booking-schedule";
import type { Vendor } from "@/types/database";

const START = 7 * 60;
const END = 23 * 60;
const CELLS = (END - START) / SLOT_STEP_MIN;

// Lunes de referencia (2024-01-01 fue lunes) para pedirle al parser del
// horario del local las franjas de cada día de la semana.
const BASE_MONDAY = Date.UTC(2024, 0, 1);

function isoForWeekday(dayKey: string): string {
  const idx = WEEKDAY_ORDER.indexOf(dayKey as (typeof WEEKDAY_ORDER)[number]);
  const d = new Date(BASE_MONDAY + (idx < 0 ? 0 : idx) * 86400000);
  return d.toISOString().slice(0, 10);
}

function rangesToCells(ranges: Range[]): boolean[] {
  const cells = new Array(CELLS).fill(false);
  for (const [o, c] of ranges) {
    for (let i = 0; i < CELLS; i++) {
      const t = START + i * SLOT_STEP_MIN;
      if (t >= o && t < c) cells[i] = true;
    }
  }
  return cells;
}

function cellsToRanges(cells: boolean[]): [string, string][] {
  const out: [string, string][] = [];
  let start: number | null = null;
  for (let i = 0; i <= CELLS; i++) {
    const on = i < CELLS && cells[i];
    if (on && start === null) start = START + i * SLOT_STEP_MIN;
    if (!on && start !== null) {
      out.push([fmtMinutes(start), fmtMinutes(START + i * SLOT_STEP_MIN)]);
      start = null;
    }
  }
  return out;
}

type StaffRow = { id: string; name: string; active?: boolean | null; availability?: unknown };
type ScheduleDay = { id: string; staff_id: string; staff_name: string | null; day: string; ranges: unknown };

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function EsteticaScheduleSection({
  vendor,
  saveVendor,
  setMsg,
}: {
  vendor: Vendor | null;
  saveVendor: (patch: Record<string, unknown>) => Promise<void>;
  setMsg: (m: string) => void;
}) {
  const [mode, setMode] = useState<string>((vendor as any)?.booking_schedule_mode === "grid" ? "grid" : "hours");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffId, setStaffId] = useState("");
  const [grid, setGrid] = useState<Record<string, boolean[]>>({});
  const [days, setDays] = useState<ScheduleDay[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState("");
  // Alta de ajuste por fecha.
  const [newDate, setNewDate] = useState("");
  const [newClosed, setNewClosed] = useState(false);
  const [newFrom, setNewFrom] = useState("09:00");
  const [newTo, setNewTo] = useState("13:00");

  async function load() {
    try {
      const [sRes, dRes] = await Promise.all([
        fetch("/api/vendor/estetica-staff"),
        fetch("/api/vendor/estetica-schedule-days"),
      ]);
      if (dRes.status === 503) {
        setMissing(true);
        return;
      }
      const sData = await sRes.json().catch(() => ({}));
      const list: StaffRow[] = (sData.staff || []).filter((s: StaffRow) => s.active !== false);
      setStaff(list);
      const dData = await dRes.json().catch(() => ({}));
      setDays(dData.days || []);
      if (list.length > 0 && !list.some((s) => s.id === staffId)) {
        setStaffId(list[0].id);
      }
    } catch {
      setLocalMsg("Error de conexión");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMode((vendor as any)?.booking_schedule_mode === "grid" ? "grid" : "hours");
  }, [vendor]);

  // Celdas del profesional elegido.
  useEffect(() => {
    const st = staff.find((s) => s.id === staffId);
    const av = parseAvailability(st?.availability);
    const next: Record<string, boolean[]> = {};
    for (const d of WEEKDAY_ORDER) {
      next[d] = rangesToCells(av?.[d] || []);
    }
    setGrid(next);
  }, [staffId, staff]);

  // Horario del local por día (para "copiar").
  const localByDay = useMemo(() => {
    const out: Record<string, Range[]> = {};
    for (const d of WEEKDAY_ORDER) {
      out[d] = shiftsFromHoursText(vendor?.hours || null, isoForWeekday(d)) || [];
    }
    return out;
  }, [vendor?.hours]);

  if (missing) {
    return (
      <Card className="p-4">
        <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          Falta aplicar la migración <code>migrate-estetica-schedule.sql</code> en la base para usar la agenda por semana.
        </p>
      </Card>
    );
  }

  async function changeMode(next: string) {
    setMode(next);
    try {
      await saveVendor({ booking_schedule_mode: next });
      setLocalMsg(next === "grid" ? "Agenda por semana activada" : "Se seguirá el horario del local");
    } catch {
      setLocalMsg("Error al guardar");
    }
  }

  function toggleCell(day: string, i: number) {
    setGrid((prev) => {
      const cells = [...(prev[day] || new Array(CELLS).fill(false))];
      cells[i] = !cells[i];
      return { ...prev, [day]: cells };
    });
  }

  function copyLocal() {
    setGrid(() => {
      const next: Record<string, boolean[]> = {};
      for (const d of WEEKDAY_ORDER) next[d] = rangesToCells(localByDay[d] || []);
      return next;
    });
    setLocalMsg("Horario del local copiado (no olvides guardar)");
  }

  async function saveGrid() {
    if (!staffId) return;
    setBusy(true);
    setLocalMsg("");
    try {
      const availability: Record<string, [string, string][]> = {};
      for (const d of WEEKDAY_ORDER) availability[d] = cellsToRanges(grid[d] || []);
      const res = await fetch(`/api/vendor/estetica-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
      setStaff((prev) => prev.map((s) => (s.id === staffId ? { ...s, availability } : s)));
      setLocalMsg("Agenda guardada");
      setMsg("Agenda guardada");
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function addDay() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !staffId) {
      setLocalMsg("Elegí fecha y profesional");
      return;
    }
    const ranges = newClosed ? [] : [[newFrom, newTo]];
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/estetica-schedule-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newDate, staff_id: staffId, ranges }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
      setNewDate("");
      setLocalMsg(newClosed ? "Día cerrado" : "Día abierto con horario propio");
      load();
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function removeDay(id: string) {
    try {
      await fetch(`/api/vendor/estetica-schedule-days?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      load();
    } catch {
      setLocalMsg("No se pudo eliminar");
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">🗓️ Agenda de turnos</p>
        <p className="text-xs text-muted-foreground">
          Seguí el horario del local o planificá por semana las horas de cada profesional (lo no marcado queda bloqueado).
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => changeMode("hours")}
          className={`text-left rounded-lg border px-3 py-2 text-sm ${mode === "hours" ? "border-primary bg-primary/10" : "border-border"}`}
        >
          <span className="font-medium">Seguir el horario del local</span>
          <span className="block text-xs text-muted-foreground">Usa los horarios de "Ubicación y horarios".</span>
        </button>
        <button
          type="button"
          onClick={() => changeMode("grid")}
          className={`text-left rounded-lg border px-3 py-2 text-sm ${mode === "grid" ? "border-primary bg-primary/10" : "border-border"}`}
        >
          <span className="font-medium">Agenda por semana</span>
          <span className="block text-xs text-muted-foreground">Marcá las horas de cada profesional; el resto queda bloqueado.</span>
        </button>
      </div>

      {mode === "grid" && (
        <>
          {staff.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Cargá profesionales más arriba para asignarles su agenda.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="h-9 flex-1 min-w-40 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <Button size="sm" variant="outline" onClick={copyLocal}>Copiar horario del local</Button>
              </div>

              <div className="overflow-x-auto -mx-1 px-1">
                <table className="border-separate border-spacing-0.5 text-[10px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-card px-1 text-muted-foreground font-normal"></th>
                      {WEEKDAY_ORDER.map((d) => (
                        <th key={d} className="px-0.5 text-muted-foreground font-medium">{DAY_LABEL[d]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: CELLS }).map((_, i) => {
                      const t = START + i * SLOT_STEP_MIN;
                      const showLabel = t % 60 === 0;
                      return (
                        <tr key={i}>
                          <td className="sticky left-0 bg-card pr-1 text-right text-muted-foreground whitespace-nowrap">
                            {showLabel ? fmtMinutes(t) : ""}
                          </td>
                          {WEEKDAY_ORDER.map((d) => {
                            const on = grid[d]?.[i];
                            return (
                              <td key={d} className="p-0">
                                <button
                                  type="button"
                                  onClick={() => toggleCell(d, i)}
                                  className={`w-6 h-4 rounded-sm ${on ? "bg-primary" : "bg-muted hover:bg-muted-foreground/20"}`}
                                  aria-label={`${DAY_LABEL[d]} ${fmtMinutes(t)}`}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Toca las casillas para habilitar/bloquear cada media hora. Los días sin marcar quedan cerrados.
              </p>
              <Button size="sm" className="w-full" onClick={saveGrid} disabled={busy}>
                {busy ? "Guardando..." : "Guardar agenda del profesional"}
              </Button>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-sm font-medium">Excepciones por fecha</p>
                <p className="text-xs text-muted-foreground">
                  Para feriados o días con horario distinto al habitual (del profesional elegido).
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-9 text-sm" />
                  <label className="flex items-center gap-2 text-xs rounded-md border border-border px-2">
                    <Switch checked={newClosed} onCheckedChange={setNewClosed} />
                    Cerrado
                  </label>
                </div>
                {!newClosed && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Desde</Label>
                      <Input type="time" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} className="mt-1 h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Hasta</Label>
                      <Input type="time" value={newTo} onChange={(e) => setNewTo(e.target.value)} className="mt-1 h-9 text-sm" />
                    </div>
                  </div>
                )}
                <Button size="sm" variant="outline" className="w-full" onClick={addDay} disabled={busy}>
                  Guardar excepción
                </Button>
                {days.length > 0 && (
                  <div className="space-y-1">
                    {days.map((d) => {
                      const empty = Array.isArray(d.ranges) && d.ranges.length === 0;
                      const rng = Array.isArray(d.ranges)
                        ? (d.ranges as string[][]).map((r) => `${r[0]}–${r[1]}`).join(" · ")
                        : "";
                      return (
                        <div key={d.id} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                          <span className="flex-1 min-w-0 truncate">
                            <strong>{fmtDate(d.day)}</strong> · {d.staff_name || ""}
                            <span className="text-muted-foreground"> — {empty ? "cerrado" : rng}</span>
                          </span>
                          <button type="button" onClick={() => removeDay(d.id)} className="flex-shrink-0 text-muted-foreground hover:text-red-600" title="Quitar">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {localMsg && <p className="text-xs text-muted-foreground">{localMsg}</p>}
    </Card>
  );
}
