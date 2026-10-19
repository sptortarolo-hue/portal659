"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  HOUR_HEIGHT,
  MONTH_WEEKDAYS,
  addDaysISO,
  addMonthsISO,
  agendaWindow,
  arNowMinutes,
  blockHeight,
  blockTop,
  bookingDurationMinutes,
  bookingStartMinutes,
  buildDayColumns,
  buildMonthGrid,
  formatDayLabel,
  minutesToLabel,
  monthLabel,
  startOfMonthISO,
  statusTone,
  type AgendaBooking,
  type AgendaStaff,
  type MonthCell,
} from "@/lib/agenda";
import { arToday } from "@/lib/booking-schedule";

export type AgendaViewMode = "day" | "month" | "plan" | "list";

type Props = {
  /** Turnos ya filtrados por estado (el panel maneja el chip de estado). */
  bookings: AgendaBooking[];
  staff: AgendaStaff[];
  dateISO: string;
  onDate: (iso: string) => void;
  view: AgendaViewMode;
  onView: (v: AgendaViewMode) => void;
  onOpenBooking: (id: string) => void;
  /** Abre la vista Día en esa fecha (drill-down desde el Mes). */
  onDaySelect: (iso: string) => void;
  /** Alta de turno precargando fecha y profesional (celda vacía del Mes). */
  onCreateBooking?: (iso: string, staffId?: string) => void;
  /** Contenido de la vista Lista (la lista agrupada que arma el panel). */
  listContent: ReactNode;
  /** Contenido de la vista Planificar (grilla semanal; solo estética). */
  planContent?: ReactNode;
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
  staffFilter,
  onOpenBooking,
}: {
  bookings: AgendaBooking[];
  staff: AgendaStaff[];
  dateISO: string;
  staffFilter: string;
  onOpenBooking: (id: string) => void;
}) {
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

/** Puntos de estado del Mes (mismo criterio de color que `statusTone`). */
const MONTH_DOTS: { key: keyof MonthCell["byStatus"]; className: string; label: string }[] = [
  { key: "pending", className: "bg-amber-400", label: "pendientes" },
  { key: "confirmed", className: "bg-emerald-500", label: "confirmados" },
  { key: "noshow", className: "bg-orange-400", label: "ausentes" },
  { key: "cancelled", className: "bg-muted-foreground/50", label: "cancelados" },
];

function StatusDots({ byStatus }: { byStatus: MonthCell["byStatus"] }) {
  return (
    <span className="flex items-center gap-0.5">
      {MONTH_DOTS.map((d) =>
        byStatus[d.key] > 0 ? (
          <span
            key={d.key}
            className={`h-1.5 w-1.5 rounded-full ${d.className}`}
            title={`${byStatus[d.key]} ${d.label}`}
          />
        ) : null
      )}
    </span>
  );
}

function AgendaMonth({
  bookings,
  dateISO,
  staffFilter,
  onDaySelect,
  onCreateBooking,
}: {
  bookings: AgendaBooking[];
  dateISO: string;
  staffFilter: string;
  onDaySelect: (iso: string) => void;
  onCreateBooking?: (iso: string, staffId?: string) => void;
}) {
  const cells = useMemo(
    () => buildMonthGrid(dateISO, bookings, { staffId: staffFilter }),
    [dateISO, bookings, staffFilter]
  );
  const totalMonth = cells.reduce((acc, c) => (c.inMonth ? acc + c.count : acc), 0);
  const noDate = bookings.filter(
    (b) => !/^\d{4}-\d{2}-\d{2}$/.test(String(b.booking_date || "").slice(0, 10))
  ).length;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
        {MONTH_WEEKDAYS.map((d) => (
          <div key={d} className="bg-muted/50 px-1 py-1 text-center text-[10px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((cell) => (
          <button
            key={cell.iso}
            type="button"
            onClick={() =>
              cell.count > 0 ? onDaySelect(cell.iso) : onCreateBooking?.(cell.iso, staffFilter)
            }
            className={`flex min-h-[60px] flex-col gap-1 p-1.5 text-left transition-colors md:min-h-[104px] ${
              cell.inMonth ? "bg-card hover:bg-muted/60" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
            title={
              cell.count > 0
                ? `${cell.count} turno(s) — abrir el día`
                : onCreateBooking
                  ? "Agendar turno"
                  : undefined
            }
          >
            <span className="flex items-center justify-between gap-1">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ${
                  cell.isToday ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {cell.day}
              </span>
              {cell.count > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
                  {cell.count}
                </span>
              )}
            </span>

            {cell.count > 0 && (
              <span className="md:hidden">
                <StatusDots byStatus={cell.byStatus} />
              </span>
            )}

            {cell.count > 0 && (
              <span className="hidden min-w-0 flex-col gap-0.5 overflow-hidden md:flex">
                {cell.items.slice(0, 3).map((b) => (
                  <span key={b.id} className="flex min-w-0 items-center gap-1 text-[10px] leading-tight">
                    <span className="tabular-nums text-muted-foreground">{shortTime(b)}</span>
                    <span className="truncate">{String(b.customer_name || "Sin nombre")}</span>
                  </span>
                ))}
                {cell.count > 3 && (
                  <span className="text-[10px] font-medium text-muted-foreground">+{cell.count - 3} más</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {MONTH_DOTS.map((d) => (
            <span key={d.key} className="flex items-center gap-1">
              <span className={`h-1.5 w-1.5 rounded-full ${d.className}`} />
              {d.label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {totalMonth > 0 ? `${totalMonth} turno(s) este mes` : "Sin turnos este mes"} · tocá un día con turnos para ver el detalle
        </p>
      </div>

      {noDate > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {noDate} turno(s) sin fecha — miralos en la vista Lista.
        </p>
      )}
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
  onDaySelect,
  onCreateBooking,
  listContent,
  planContent,
}: Props) {
  const today = arToday();
  const [staffFilter, setStaffFilter] = useState<string>("all");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => onView("month")}
            className={`px-3 h-8 text-xs font-medium ${view === "month" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            🗓️ Mes
          </button>
          <button
            type="button"
            onClick={() => onView("day")}
            className={`px-3 h-8 text-xs font-medium border-l border-border ${view === "day" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
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
          {planContent != null && (
            <button
              type="button"
              onClick={() => onView("plan")}
              className={`px-3 h-8 text-xs font-medium border-l border-border ${view === "plan" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
            >
              ✏️ Planificar
            </button>
          )}
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

        {view === "month" && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => onDate(addMonthsISO(dateISO, -1))} aria-label="Mes anterior">
              ‹
            </Button>
            <span className="inline-flex h-8 items-center px-1 text-sm font-medium whitespace-nowrap">
              {monthLabel(dateISO)}
            </span>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => onDate(addMonthsISO(dateISO, 1))} aria-label="Mes siguiente">
              ›
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => onDate(today)}
              disabled={startOfMonthISO(dateISO) === startOfMonthISO(today)}
            >
              Hoy
            </Button>
          </div>
        )}
      </div>

      {(view === "day" || view === "month") && staff.length > 1 && (
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

      {view === "day" && (
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
          <AgendaDay
            bookings={bookings}
            staff={staff}
            dateISO={dateISO}
            staffFilter={staffFilter}
            onOpenBooking={onOpenBooking}
          />
        </>
      )}

      {view === "month" && (
        <AgendaMonth
          bookings={bookings}
          dateISO={dateISO}
          staffFilter={staffFilter}
          onDaySelect={onDaySelect}
          onCreateBooking={onCreateBooking}
        />
      )}

      {view === "list" && listContent}

      {view === "plan" && planContent}
    </div>
  );
}
