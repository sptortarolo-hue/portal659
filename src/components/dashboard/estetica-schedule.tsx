"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeSelect24 } from "@/components/ui/time-select-24";
import {
  DAY_LABEL,
  WEEKDAY_ORDER,
  parseAvailability,
  shiftsFromHoursText,
  type Range,
} from "@/lib/booking-schedule";
import type { Vendor } from "@/types/database";

// Lunes de referencia (2024-01-01 fue lunes) para pedirle al parser del
// horario del local las franjas de cada día de la semana.
const BASE_MONDAY = Date.UTC(2024, 0, 1);

function isoForWeekday(dayKey: string): string {
  const idx = WEEKDAY_ORDER.indexOf(dayKey as (typeof WEEKDAY_ORDER)[number]);
  const d = new Date(BASE_MONDAY + (idx < 0 ? 0 : idx) * 86400000);
  return d.toISOString().slice(0, 10);
}

const FULL_DAY_NAMES: Record<string, string> = {
  lun: "Lunes",
  mar: "Martes",
  mie: "Miércoles",
  jue: "Jueves",
  vie: "Viernes",
  sab: "Sábado",
  dom: "Domingo",
};

type Shift = { open: string; close: string };
type DayCfg = { closed: boolean; shifts: Shift[] };

function minsToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// Máximo de franjas por día (mañana + tarde/noche), igual que el horario del local.
const MAX_SHIFTS = 2;

function rangesToShifts(ranges: Range[] | null | undefined): Shift[] {
  return (ranges || [])
    .slice(0, MAX_SHIFTS)
    .map(([o, c]) => ({ open: minsToHHMM(o), close: minsToHHMM(c) }));
}

/** availability jsonb → config de los 7 días. Días ausentes/vacíos = cerrado. */
function availabilityToCfg(raw: unknown): Record<string, DayCfg> {
  const av = parseAvailability(raw);
  const out: Record<string, DayCfg> = {};
  for (const d of WEEKDAY_ORDER) {
    const shifts = rangesToShifts(av?.[d]);
    out[d] = { closed: shifts.length === 0, shifts: shifts.length ? shifts : [{ open: "09:00", close: "18:00" }] };
  }
  return out;
}

/** Horario del local (vendors.hours) → config de los 7 días (para prefill/copiar). */
function localCfgFromHours(hours: string | null | undefined): Record<string, DayCfg> {
  const out: Record<string, DayCfg> = {};
  for (const d of WEEKDAY_ORDER) {
    const shifts = rangesToShifts(shiftsFromHoursText(hours || null, isoForWeekday(d)));
    out[d] = { closed: shifts.length === 0, shifts: shifts.length ? shifts : [{ open: "09:00", close: "18:00" }] };
  }
  return out;
}

/** config de los 7 días → availability jsonb (cerrado = []). */
function cfgToAvailability(cfg: Record<string, DayCfg>): Record<string, [string, string][]> {
  const out: Record<string, [string, string][]> = {};
  for (const d of WEEKDAY_ORDER) {
    const day = cfg[d];
    out[d] =
      day && !day.closed
        ? day.shifts.filter((s) => s.open && s.close).map((s) => [s.open, s.close] as [string, string])
        : [];
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
  const [cfg, setCfg] = useState<Record<string, DayCfg>>(() => availabilityToCfg(null));
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

  // Config del profesional elegido. Sin grilla guardada aún (availability null)
  // se prellenará con el horario del local para editar en vez de armar de cero.
  useEffect(() => {
    const st = staff.find((s) => s.id === staffId);
    const av = parseAvailability(st?.availability);
    setCfg(av ? availabilityToCfg(st?.availability) : localCfgFromHours(vendor?.hours || null));
  }, [staffId, staff, vendor?.hours]);

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

  function setDay(day: string, patch: Partial<DayCfg>) {
    setCfg((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  function toggleDay(day: string) {
    setCfg((prev) => ({ ...prev, [day]: { ...prev[day], closed: !prev[day].closed } }));
  }

  function updateShift(day: string, idx: number, patch: Partial<Shift>) {
    setCfg((prev) => {
      const d = prev[day];
      return { ...prev, [day]: { ...d, shifts: d.shifts.map((s, i) => (i === idx ? { ...s, ...patch } : s)) } };
    });
  }

  function addShift(day: string) {
    setCfg((prev) => {
      const d = prev[day];
      if (d.shifts.length >= MAX_SHIFTS) return prev;
      return { ...prev, [day]: { ...d, shifts: [...d.shifts, { open: "17:00", close: "21:00" }] } };
    });
  }

  function removeShift(day: string) {
    setCfg((prev) => ({ ...prev, [day]: { ...prev[day], shifts: prev[day].shifts.slice(0, 1) } }));
  }

  function copyToAll(day: string) {
    setCfg((prev) => {
      const src = prev[day];
      const next: Record<string, DayCfg> = {};
      for (const d of WEEKDAY_ORDER) next[d] = { closed: src.closed, shifts: src.shifts.map((s) => ({ ...s })) };
      return next;
    });
    setLocalMsg("Día copiado a toda la semana (no olvides guardar)");
  }

  function copyLocal() {
    setCfg(localCfgFromHours(vendor?.hours || null));
    setLocalMsg("Horario del local copiado (no olvides guardar)");
  }

  async function saveGrid() {
    if (!staffId) return;
    setBusy(true);
    setLocalMsg("");
    try {
      const availability = cfgToAvailability(cfg);
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
          Seguí el horario del local o planificá por semana las franjas de cada profesional (lo no marcado queda bloqueado).
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
          <span className="block text-xs text-muted-foreground">Marcá las franjas de cada profesional; el resto queda bloqueado.</span>
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

              <div className="space-y-2">
                {WEEKDAY_ORDER.map((d) => {
                  const day = cfg[d];
                  if (!day) return null;
                  return (
                    <div key={d} className="rounded-xl border border-border bg-card p-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Switch checked={!day.closed} onCheckedChange={() => toggleDay(d)} aria-label={`${FULL_DAY_NAMES[d]} abierto`} />
                        <span className="text-sm font-medium flex-1">{FULL_DAY_NAMES[d]}</span>
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground hover:text-primary font-medium"
                          onClick={() => copyToAll(d)}
                          title="Copiar a toda la semana"
                        >
                          ⧉ Copiar
                        </button>
                        <span className={`text-[11px] ${day.closed ? "text-muted-foreground" : "text-primary font-medium"}`}>
                          {day.closed ? "Cerrado" : "Abierto"}
                        </span>
                      </div>

                      {!day.closed && (
                        <div className="space-y-2">
                          {day.shifts.map((shift, sIdx) => (
                            <div key={sIdx} className="flex items-center gap-1.5 w-full">
                              {day.shifts.length === 2 && (
                                <span className="text-[10px] text-muted-foreground w-12 flex-shrink-0 text-right">
                                  {sIdx === 0 ? "Mañana" : "Tarde"}
                                </span>
                              )}
                              <TimeSelect24
                                value={shift.open}
                                onChange={(v) => updateShift(d, sIdx, { open: v })}
                                aria-label={`${FULL_DAY_NAMES[d]} apertura`}
                              />
                              <span className="text-muted-foreground flex-shrink-0 text-xs">a</span>
                              <TimeSelect24
                                value={shift.close}
                                onChange={(v) => updateShift(d, sIdx, { close: v })}
                                aria-label={`${FULL_DAY_NAMES[d]} cierre`}
                              />
                              {day.shifts.length === 2 && (
                                <button
                                  type="button"
                                  onClick={() => removeShift(d)}
                                  className="h-9 w-9 rounded-md text-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 flex items-center justify-center flex-shrink-0"
                                  aria-label="Quitar franja"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                          {day.shifts.length < MAX_SHIFTS && (
                            <button
                              type="button"
                              className="text-[11px] text-primary font-medium"
                              onClick={() => addShift(d)}
                            >
                              + Agregar franja (tarde/noche)
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Los días apagados o sin franja quedan cerrados (no se pueden reservar).
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
