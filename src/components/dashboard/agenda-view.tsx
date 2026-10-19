"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  HOUR_HEIGHT,
  MIN_BLOCK_PX,
  PX_PER_MIN,
  addDaysISO,
  agendaWindow,
  arNowMinutes,
  blockHeight,
  blockTop,
  bookingDurationMinutes,
  bookingStartMinutes,
  buildDayColumns,
  formatDayLabel,
  minutesToLabel,
  statusTone,
  type AgendaBooking,
  type AgendaStaff,
} from "@/lib/agenda";
import { arToday } from "@/lib/booking-schedule";

export type AgendaViewMode = "day" | "list";

type Props = {
  /** Turnos ya filtrados por estado (el panel maneja el chip de estado). */
  bookings: AgendaBooking[];
  staff: AgendaStaff[];
  dateISO: string;
  onDate: (iso: string) => void;
  view: AgendaViewMode;
  onView: (v: AgendaViewMode) => void;
  onOpenBooking: (id: string) => void;
  /** Contenido de la vista Lista (la lista agrupada que arma el panel). */
  listContent: ReactNode;
};

function shortTime(b: AgendaBooking): string {
  const s = bookingStartMinutes(b);
  return s == null ? "--:--" : minutesToLabel(s);
}

function BookingBlock({
  b,
  windowStartMin,
  onOpen,
}: {
  b: AgendaBooking;
  windowStartMin: number;
  onOpen: (id: string) => void;
}) {
  const start = bookingStartMinutes(b) ?? windowStartMin;
  const dur = bookingDurationMinutes(b);
  const height = blockHeight(dur);
  const time = minutesToLabel(start);
  const name = String(b.customer_name || "Sin nombre");
  const service = String(b.service_label || b.product_label || b.product_name || "");
  const staffLabel = String(b.staff_label || "");
  const deposit = (b as any).deposit_status === "paid";
  const preview = (b as any).is_preview === true;

  return (
    <button
      type="button"
      onClick={() => onOpen(b.id)}
      style={{ top: blockTop(start, windowStartMin), height }}
      className={`absolute left-0.5 right-0.5 overflow-hidden rounded-md border-l-4 px-1.5 py-0.5 text-left shadow-sm transition-colors ${statusTone(b.status)}`}
      title={`${time} · ${name}${service ? ` · ${service}` : ""}`}
    >
      <span className="flex items-center gap-1 text-[10px] font-semibold leading-tight tabular-nums">
        {time}
        {preview && <span title="Turno de prueba">🧪</span>}
        {deposit && <span title="Seña pagada">✅</span>}
      </span>
      <span className="block truncate text-[11px] font-medium leading-tight">{name}</span>
      {height >= 40 && service && (
        <span className="block truncate text-[10px] leading-tight opacity-80">{service}</span>
      )}
      {height >= 56 && staffLabel && (
        <span className="block truncate text-[10px] leading-tight opacity-70">{staffLabel}</span>
      )}
    </button>
  );
}

function AgendaDay({
  bookings,
  staff,
  dateISO,
  onOpenBooking,
}: {
  bookings: AgendaBooking[];
  staff: AgendaStaff[];
  dateISO: string;
  onOpenBooking: (id: string) => void;
}) {
  const [staffFilter, setStaffFilter] = useState<string>("all");

  const dayBookings = useMemo(() => {
    const base = bookings.filter((b) => String(b.booking_date || "").slice(0, 10) === dateISO && bookingStartMinutes(b) != null);
    return staffFilter === "all" ? base : base.filter((b) => (b.staff_id || "") === staffFilter);
  }, [bookings, dateISO, staffFilter]);

  const { startMin, endMin } = useMemo(() => agendaWindow(dayBookings), [dayBookings]);
  const totalHeight = ((endMin - startMin) / 60) * HOUR_HEIGHT;
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = startMin; m <= endMin; m += 60) out.push(m);
    return out;
  }, [startMin, endMin]);

  const cols = useMemo(() => buildDayColumns(dayBookings, dateISO, staff), [dayBookings, dateISO, staff]);

  const isToday = dateISO === arToday();
  const nowMin = arNowMinutes();
  const showNow = isToday && nowMin >= startMin && nowMin <= endMin;

  return (
    <div className="space-y-2">
      {staff.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Profesional</label>
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="h-8 flex-1 max-w-56 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">Todos</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-max">
          {/* Encabezado: riel vacío + columnas por profesional */}
          <div className="flex border-b border-border">
            <div className="sticky left-0 z-10 w-12 flex-shrink-0 bg-card" />
            {cols.map((c, i) => (
              <div
                key={c.id || `col-${i}`}
                className="w-40 flex-shrink-0 border-l border-border px-2 py-1 text-xs font-medium truncate"
                title={c.name}
              >
                {c.name}
                <span className="ml-1 text-muted-foreground">({c.bookings.length})</span>
              </div>
            ))}
          </div>

          {/* Cuerpo: riel de horas + carriles con bloques */}
          <div className="flex">
            <div className="sticky left-0 z-10 w-12 flex-shrink-0 bg-card" style={{ height: totalHeight }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute w-12 pr-1 text-right text-[10px] text-muted-foreground tabular-nums"
                  style={{ top: ((h - startMin) / 60) * HOUR_HEIGHT - 6, left: 0 }}
                >
                  {minutesToLabel(h)}
                </div>
              ))}
            </div>

            {cols.map((c, i) => (
              <div
                key={c.id || `col-${i}`}
                className="relative w-40 flex-shrink-0 border-l border-border"
                style={{ height: totalHeight }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/50"
                    style={{ top: ((h - startMin) / 60) * HOUR_HEIGHT }}
                  />
                ))}
                {showNow && (
                  <div
                    className="absolute inset-x-0 z-10 border-t-2 border-red-500"
                    style={{ top: ((nowMin - startMin) / 60) * HOUR_HEIGHT }}
                  >
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
                  </div>
                )}
                {c.bookings.map((b) => (
                  <BookingBlock key={b.id} b={b} windowStartMin={startMin} onOpen={onOpenBooking} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {dayBookings.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No hay turnos {staffFilter === "all" ? "este día" : "para ese profesional"}. Usá ‹ › para ver otro día.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Tocá un turno para ver el detalle. Bloques en amarillo = pendientes, verde = confirmados.
      </p>
    </div>
  );
}

export function AgendaView({
  bookings,
  staff,
  dateISO,
  onDate,
  view,
  onView,
  onOpenBooking,
  listContent,
}: Props) {
  const today = arToday();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => onView("day")}
            className={`px-3 h-8 text-xs font-medium ${view === "day" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            📅 Día
          </button>
          <button
            type="button"
            onClick={() => onView("list")}
            className={`px-3 h-8 text-xs font-medium border-l border-border ${view === "list" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            ☰ Lista
          </button>
        </div>

        {view === "day" && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => onDate(addDaysISO(dateISO, -1))} aria-label="Día anterior">
              ‹
            </Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => onDate(today)} disabled={dateISO === today}>
              Hoy
            </Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => onDate(addDaysISO(dateISO, 1))} aria-label="Día siguiente">
              ›
            </Button>
            {dateISO !== today && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {dateISO < today ? "pasado" : "próximo"}
              </span>
            )}
          </div>
        )}
      </div>

      {view === "day" ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{formatDayLabel(dateISO)}</p>
            <label className="text-xs text-muted-foreground">
              <input
                type="date"
                value={dateISO}
                onChange={(e) => e.target.value && onDate(e.target.value)}
                className="ml-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
          </div>
          <AgendaDay bookings={bookings} staff={staff} dateISO={dateISO} onOpenBooking={onOpenBooking} />
        </>
      ) : (
        listContent
      )}
    </div>
  );
}
