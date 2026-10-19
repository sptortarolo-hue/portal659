"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DAY_LABEL,
  SLOT_STEP_MIN,
  WEEKDAY_ORDER,
  arToday,
  availabilityToSlotMap,
  dayKeyForISO,
  fmtDateShort,
  fmtMinutes,
  hoursTextToSlotMap,
  parseAvailability,
  plannerWindow,
  slotMapToAvailability,
  startOfWeekISO,
  weekDatesISO,
  shiftISODate,
} from "@/lib/booking-schedule";
import type { Vendor } from "@/types/database";

type StaffRow = { id: string; name: string; active?: boolean | null; availability?: unknown };
type ScheduleDay = { id: string; staff_id: string; day: string; ranges: unknown };

type SlotMap = Record<string, Set<number>>;

const emptyMap = (): SlotMap => {
  const out: SlotMap = {};
  for (const d of WEEKDAY_ORDER) out[d] = new Set<number>();
  return out;
};

const mapSignature = (m: SlotMap) => JSON.stringify(slotMapToAvailability(m));

/**
 * Planner semanal de la turnera (estética): grilla día × hora (bloques de
 * 30 min) donde el dueño marca la ventana de disponibilidad de cada
 * profesional. La duración del servicio manda al ofrecer horarios al cliente;
 * acá sólo se define *cuándo* puede atender. Guarda el mismo
 * `estetica_staff.availability` que el editor de Config (sin migración).
 */
export function EsteticaWeekPlanner({
  vendor,
  saveVendor,
  setMsg,
}: {
  vendor: Vendor | null;
  saveVendor: (patch: Record<string, unknown>) => Promise<void>;
  setMsg: (m: string) => void;
}) {
  const today = useMemo(() => arToday(), []);
  const [weekStart, setWeekStart] = useState(() => startOfWeekISO(today));
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffId, setStaffId] = useState("");
  const [byDay, setByDay] = useState<SlotMap>(emptyMap);
  const [savedSig, setSavedSig] = useState<string>(() => mapSignature(emptyMap()));
  const [exDays, setExDays] = useState<ScheduleDay[]>([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState("");

  const isGrid = (vendor as { booking_schedule_mode?: string | null } | null)?.booking_schedule_mode === "grid";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [sRes, dRes] = await Promise.all([
          fetch("/api/vendor/estetica-staff"),
          fetch("/api/vendor/estetica-schedule-days"),
        ]);
        if (cancelled) return;
        if (dRes.status === 503) {
          setMissing(true);
          setLoading(false);
          return;
        }
        const sData = await sRes.json().catch(() => ({}));
        const list: StaffRow[] = (sData.staff || []).filter((s: StaffRow) => s.active !== false);
        setStaff(list);
        const dData = await dRes.json().catch(() => ({}));
        setExDays(Array.isArray(dData.days) ? dData.days : []);
        setStaffId((cur) => (list.some((s) => s.id === cur) ? cur : list[0]?.id || ""));
      } catch {
        if (!cancelled) setLocalMsg("Error de conexión");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Carga la grilla del profesional elegido (prefill con horario del local).
  useEffect(() => {
    const st = staff.find((s) => s.id === staffId);
    if (!st) {
      const m = emptyMap();
      setByDay(m);
      setSavedSig(mapSignature(m));
      return;
    }
    const av = parseAvailability(st.availability);
    const m = av ? availabilityToSlotMap(st.availability) : hoursTextToSlotMap(vendor?.hours || null);
    setByDay(m);
    setSavedSig(mapSignature(m));
    setLocalMsg("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, staff, vendor?.hours]);

  const dirty = mapSignature(byDay) !== savedSig;
  const weekDates = useMemo(() => weekDatesISO(weekStart), [weekStart]);
  const window = useMemo(() => plannerWindow(byDay), [byDay]);
  const rows = useMemo(() => {
    const out: number[] = [];
    for (let t = window.start; t < window.end; t += SLOT_STEP_MIN) out.push(t);
    return out;
  }, [window.start, window.end]);
  const exByDate = useMemo(() => {
    const map = new Map<string, ScheduleDay[]>();
    for (const d of exDays) {
      if (d.staff_id !== staffId) continue;
      const iso = String(d.day || "").slice(0, 10);
      const arr = map.get(iso) || [];
      arr.push(d);
      map.set(iso, arr);
    }
    return map;
  }, [exDays, staffId]);

  function toggle(day: string, t: number) {
    setByDay((prev) => {
      const set = new Set(prev[day] || []);
      if (set.has(t)) set.delete(t);
      else set.add(t);
      return { ...prev, [day]: set };
    });
  }

  function toggleColumn(day: string) {
    const cur = byDay[day] || new Set<number>();
    const allOn = rows.length > 0 && rows.every((t) => cur.has(t));
    setByDay((prev) => {
      const set = new Set(prev[day] || []);
      for (const t of rows) {
        if (allOn) set.delete(t);
        else set.add(t);
      }
      return { ...prev, [day]: set };
    });
  }

  function copyDayToAll(day: string) {
    const src = new Set(byDay[day] || []);
    setByDay((prev) => {
      const next: SlotMap = { ...prev };
      for (const d of WEEKDAY_ORDER) next[d] = new Set(src);
      return next;
    });
    setLocalMsg("Día copiado a toda la semana (no olvides guardar)");
  }

  function copyLocal() {
    setByDay(hoursTextToSlotMap(vendor?.hours || null));
    setLocalMsg("Horario del local copiado (no olvides guardar)");
  }

  function clearAll() {
    setByDay(emptyMap());
    setLocalMsg("Todo desmarcado (no olvides guardar)");
  }

  async function save() {
    if (!staffId) return;
    setBusy(true);
    setLocalMsg("");
    try {
      const availability = slotMapToAvailability(byDay);
      const res = await fetch(`/api/vendor/estetica-staff/${staffId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
      setStaff((prev) => prev.map((s) => (s.id === staffId ? { ...s, availability } : s)));
      setSavedSig(mapSignature(byDay));
      setLocalMsg("Planificación guardada");
      setMsg("Planificación guardada");
    } catch (e) {
      setLocalMsg(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function activateGrid() {
    try {
      await saveVendor({ booking_schedule_mode: "grid" });
      setLocalMsg("Agenda por semana activada");
    } catch {
      setLocalMsg("Error al guardar");
    }
  }

  if (missing) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 m-1">
        Falta aplicar la migración <code>migrate-estetica-schedule.sql</code> en la base para usar la agenda por semana.
      </p>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-3">
      {!isGrid && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1">
            Ahora la turnera usa el <strong>horario del local</strong>. Podés planificar abajo y activar la agenda
            por semana para que el cliente elija dentro de lo que marques.
          </p>
          <Button size="sm" onClick={activateGrid}>Activar agenda por semana</Button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Semana anterior"
            onClick={() => setWeekStart((w) => shiftISODate(w, -7))}
            className="h-8 w-8 rounded-md border border-input text-sm"
          >
            ‹
          </button>
          <span className="text-sm font-medium tabular-nums px-1">
            {fmtDateShort(weekStart)} – {fmtDateShort(shiftISODate(weekStart, 6))}
          </span>
          <button
            type="button"
            aria-label="Semana siguiente"
            onClick={() => setWeekStart((w) => shiftISODate(w, 7))}
            className="h-8 w-8 rounded-md border border-input text-sm"
          >
            ›
          </button>
          {weekStart !== startOfWeekISO(today) && (
            <button
              type="button"
              className="text-xs text-primary font-medium"
              onClick={() => setWeekStart(startOfWeekISO(today))}
            >
              Hoy
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={copyLocal}>Copiar horario del local</Button>
          <Button size="sm" variant="outline" onClick={clearAll}>Limpiar</Button>
        </div>
      </div>

      {staff.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          {loading ? "Cargando..." : "Cargá profesionales en la turnera para planificar su agenda."}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Profesional:</span>
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              className="h-9 flex-1 min-w-44 rounded-md border border-input bg-background px-2 text-sm"
            >
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto -mx-3 px-3">
            <div className="min-w-[560px]">
              {/* Encabezado de días */}
              <div className="grid" style={{ gridTemplateColumns: "3.25rem repeat(7, minmax(0,1fr))" }}>
                <div />
                {weekDates.map((date) => {
                  const key = dayKeyForISO(date) || "";
                  const isToday = date === today;
                  const ex = exByDate.get(date);
                  return (
                    <div key={date} className="px-0.5 pb-1 text-center">
                      <button
                        type="button"
                        onClick={() => toggleColumn(key)}
                        title="Marcar / limpiar todo el día"
                        className={`w-full rounded-md px-1 py-1 leading-tight ${isToday ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                      >
                        <span className="block text-[11px] font-semibold uppercase">{DAY_LABEL[key] || key}</span>
                        <span className="block text-[10px] text-muted-foreground tabular-nums">{fmtDateShort(date)}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => copyDayToAll(key)}
                        className="text-[10px] text-muted-foreground hover:text-primary"
                        title={`Copiar ${DAY_LABEL[key]} a toda la semana`}
                      >
                        ⧉ {ex && ex.length > 0 ? "⚠ excepción" : "copiar"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Filas de 30 min */}
              <div className="grid" style={{ gridTemplateColumns: "3.25rem repeat(7, minmax(0,1fr))" }}>
                {rows.map((t) => {
                  const label = t % 60 === 0;
                  return (
                    <Fragment key={t}>
                      <div className={`pr-1 text-[10px] text-right tabular-nums leading-none ${label ? "text-muted-foreground py-0.5" : "text-transparent"}`}>
                        {fmtMinutes(t)}
                      </div>
                      {weekDates.map((date) => {
                        const key = dayKeyForISO(date) || "";
                        const on = byDay[key]?.has(t) ?? false;
                        return (
                          <button
                            key={`${date}-${t}`}
                            type="button"
                            onClick={() => toggle(key, t)}
                            aria-pressed={on}
                            aria-label={`${DAY_LABEL[key]} ${fmtMinutes(t)}`}
                            title={`${DAY_LABEL[key]} ${fmtMinutes(t)}`}
                            className={`h-4 mb-px mx-px rounded-[3px] border transition-colors ${
                              on ? "bg-primary border-primary" : "bg-background border-border/60 hover:bg-muted"
                            }`}
                          />
                        );
                      })}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Tocá los bloques de 30 min para marcar cuándo atiende. El servicio y su duración deciden qué horarios se
            ofrecen al cliente. Las excepciones por fecha (feriados) y el modo se editan también en Config → Turnera.
          </p>

          <div className="flex items-center gap-2">
            <Button size="sm" className="flex-1 sm:flex-none" onClick={save} disabled={busy || !dirty}>
              {busy ? "Guardando..." : dirty ? "Guardar planificación" : "Guardado"}
            </Button>
            {dirty && <span className="text-[11px] text-amber-700">Cambios sin guardar</span>}
          </div>
        </>
      )}
      {localMsg && <p className="text-xs text-muted-foreground">{localMsg}</p>}
    </div>
  );
}
