"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  DAY_LABEL,
  arToday,
  dayKeyForISO,
  fmtDateShort,
  shiftISODate,
  slotRangeLabel,
  startOfWeekISO,
} from "@/lib/booking-schedule";

type DayData = {
  date: string;
  weekday: string | null;
  closed: boolean;
  blocked: boolean;
  estimated?: boolean;
  slots: { time: string; available: boolean }[];
};

type Props = {
  vendorId: string;
  serviceId: string;
  staffId?: string | null;
  /** Duración del servicio: define el rango que ocuparía el turno elegido. */
  durationMin?: number | null;
  value: { date: string; time: string };
  onPick: (date: string, time: string) => void;
};

/**
 * Picker de turnos por semana (modo "Agenda por semana"): chips de 7 días +
 * lista de horarios (paso 30 min) del día elegido. La duración del servicio
 * manda: el server sólo marca como disponible un arranque donde el turno entra
 * completo. Fallback: si no hay datos, el form clásico sigue disponible.
 */
export function WeekSlotPicker({ vendorId, serviceId, staffId, durationMin, value, onPick }: Props) {
  const today = useMemo(() => arToday(), []);
  const currentWeek = useMemo(() => startOfWeekISO(today), [today]);
  const [weekStart, setWeekStart] = useState(() => (value.date ? startOfWeekISO(value.date) : currentWeek));
  const [days, setDays] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewDate, setViewDate] = useState(value.date || today);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!serviceId) return;
    const req = ++reqRef.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ vendorId, serviceId, from: weekStart, days: "7" });
      if (staffId) qs.set("staffId", staffId);
      const res = await fetch(`/api/slot-week?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (req !== reqRef.current) return;
      setDays(Array.isArray(data.days) ? data.days : []);
    } catch {
      if (req === reqRef.current) setDays([]);
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [vendorId, serviceId, staffId, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  // Si la hora elegida dejó de estar disponible, la limpiamos.
  useEffect(() => {
    if (!value.time) return;
    const chosen = days.find((d) => d.date === value.date);
    if (chosen && !chosen.slots.some((s) => s.time === value.time && s.available)) {
      onPick(value.date, "");
    }
  }, [days, value.date, value.time, onPick]);

  // Al cambiar de semana, movemos la vista al primer día con huecos.
  useEffect(() => {
    if (days.length === 0) return;
    const cur = days.find((d) => d.date === viewDate);
    if (cur && cur.slots.some((s) => s.available)) return;
    const first =
      days.find((d) => d.date >= today && d.slots.some((s) => s.available)) ||
      days.find((d) => d.slots.some((s) => s.available)) ||
      days[0];
    if (first && first.date !== viewDate) setViewDate(first.date);
  }, [days, viewDate, today]);

  const active = days.find((d) => d.date === viewDate) || null;
  const anySlots = days.some((d) => d.slots.some((s) => s.available));
  const selectedRange = slotRangeLabel(value.time, durationMin);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="mb-0">Elegí día y horario *</Label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Semana anterior"
            disabled={weekStart <= currentWeek}
            onClick={() => setWeekStart((w) => shiftISODate(w, -7))}
            className="h-7 w-7 rounded-md border border-input text-sm disabled:opacity-40"
          >
            ‹
          </button>
          <span className="text-xs text-muted-foreground tabular-nums px-1">
            {fmtDateShort(weekStart)} – {fmtDateShort(shiftISODate(weekStart, 6))}
          </span>
          <button
            type="button"
            aria-label="Semana siguiente"
            onClick={() => setWeekStart((w) => shiftISODate(w, 7))}
            className="h-7 w-7 rounded-md border border-input text-sm"
          >
            ›
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {(days.length ? days : weekDatesPlaceholder(weekStart)).map((d) => {
          const date = d.date;
          const key = d.weekday || dayKeyForISO(date) || "";
          const past = date < today;
          const availCount = d.slots.filter((s) => s.available).length;
          const selected = date === viewDate;
          return (
            <button
              key={date}
              type="button"
              disabled={past}
              onClick={() => setViewDate(date)}
              className={`flex-shrink-0 w-16 rounded-xl border px-1 py-2 text-center transition-colors ${
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : past
                    ? "border-border text-muted-foreground/40"
                    : "border-border hover:bg-muted"
              }`}
            >
              <span className="block text-[11px] font-medium uppercase">{DAY_LABEL[key] || key}</span>
              <span className="block text-sm tabular-nums">{fmtDateShort(date)}</span>
              <span className="block h-3 text-[10px] mt-0.5">
                {date === today ? "hoy" : past ? "" : d.closed || d.blocked ? "—" : availCount > 0 ? `${availCount}` : "libre"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-border p-2.5 min-h-[64px]">
        {loading ? (
          <p className="text-xs text-muted-foreground">Buscando horarios...</p>
        ) : active?.blocked ? (
          <p className="text-xs text-muted-foreground">Ese día está bloqueado. Probá otro.</p>
        ) : active?.closed ? (
          <p className="text-xs text-muted-foreground">Cerrado ese día. Probá otro.</p>
        ) : !anySlots ? (
          <p className="text-xs text-muted-foreground">No hay horarios esta semana. Probá la siguiente.</p>
        ) : !active || active.slots.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin horarios ese día. Probá otro.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {active.slots.map((s) => (
              <button
                key={s.time}
                type="button"
                disabled={!s.available}
                onClick={() => onPick(active.date, s.time)}
                className={`rounded-lg border px-2 py-1.5 text-sm tabular-nums transition-colors ${
                  value.date === active.date && value.time === s.time
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : s.available
                      ? "border-border hover:bg-muted"
                      : "border-border text-muted-foreground/40 line-through"
                }`}
              >
                {s.time}
              </button>
            ))}
          </div>
        )}
      </div>

      {value.date && value.time && (
        <p className="text-xs text-muted-foreground">
          Turno elegido: <span className="font-medium text-foreground">{value.date} {value.time}</span>
          {selectedRange ? ` · ${selectedRange} (${durationMin} min)` : ""}
        </p>
      )}
    </div>
  );
}

/** Placeholder mientras carga la primera semana (mismo ancho de chips). */
function weekDatesPlaceholder(startISO: string): DayData[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftISODate(startISO, i);
    return { date, weekday: dayKeyForISO(date), closed: false, blocked: false, slots: [] };
  });
}
