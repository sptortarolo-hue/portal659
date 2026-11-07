"use client";

import { useMemo, useState } from "react";
import type { Booking } from "@/types/database";
import { isOrderBooking } from "@/lib/agenda";
import {
  WORK_ORDER_BOARD_COLUMNS,
  isoTodayAR,
  workOrderStateLabel,
  workOrderStateTone,
  type WorkOrderBoardFilter,
  type WorkOrderState,
} from "@/lib/work-order";
import { BookingCard, type BookingCardProps } from "@/components/dashboard/booking-card";

type TimelineItem = {
  id: string;
  at: string; // ISO para ordenar
  time: string; // "09:42"
  text: string;
  bookingId: string | null;
  tone: "green" | "amber" | "sky" | "red" | "muted";
};

/**
 * Job board "🛠️ Taller": todas las órdenes de servicio abiertas agrupadas
 * por estado (kanban horizontal de columnas).
 *
 * Dinámico:
 * - Drag & drop de tarjetas entre columnas → cambia el estado (PATCH).
 *   En mobile, los botones de avance de cada tarjeta cumplen la misma función.
 * - Stats clickeables arriba (En taller / Vencidas / Listas / Por cobrar / Recibidas hoy).
 * - Timeline de actividad reciente (últimos eventos del taller).
 * - Filtro "Mi día" por técnico (cuando hay más de un profesional).
 * - Click en la cabecera de una tarjeta → abre el detalle (modal existente).
 */
export function TallerJobBoard({
  bookings,
  filter,
  onFilter,
  bookingCardProps,
  onOpenBooking,
  quotes,
  staff,
}: {
  bookings: Booking[];
  filter: WorkOrderBoardFilter;
  onFilter: (f: WorkOrderBoardFilter) => void;
  bookingCardProps: Omit<BookingCardProps, "booking">;
  onOpenBooking?: (id: string) => void;
  /** Presupuestos del comercio (para la timeline de actividad). */
  quotes?: Record<string, unknown>[];
  /** Profesionales del local (filtro "Mi día"). */
  staff?: { id: string; name: string }[];
}) {
  const today = isoTodayAR();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<WorkOrderState | null>(null);
  const [techFilter, setTechFilter] = useState<string>("all");

  const openOrders = useMemo(() => {
    const base = (bookings || []).filter(
      (b: any) =>
        isOrderBooking(b) && b.status !== "completed" && b.status !== "cancelled"
    );
    if (techFilter === "all") return base;
    if (techFilter === "unassigned") return base.filter((b: any) => !b.staff_id);
    return base.filter((b: any) => String(b.staff_id || "") === techFilter);
  }, [bookings, techFilter]);

  const stats = useMemo(() => {
    const inWorkshop = openOrders.length;
    const overdue = openOrders.filter((b: any) => {
      const d = String(b.delivery_date || "").slice(0, 10);
      return d !== "" && d <= today;
    }).length;
    const ready = openOrders.filter((b: any) => b.status === "ready").length;
    const porCobrar = openOrders.filter(
      (b: any) =>
        Number((b as any).service_price || 0) > 0 &&
        (b as any).payment_status !== "paid"
    ).length;
    const recibidasHoy = openOrders.filter(
      (b: any) => String(b.booking_date || "").slice(0, 10) === today
    ).length;
    return { inWorkshop, overdue, ready, porCobrar, recibidasHoy };
  }, [openOrders, today]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    const all = bookings || [];
    // Eventos de órdenes: creadas (hoy) y listas recientes.
    for (const b of all as any[]) {
      if (!isOrderBooking(b)) continue;
      const created = String(b.created_at || "");
      if (created.slice(0, 10) === today) {
        items.push({
          id: `c-${b.id}`,
          at: created,
          time: created.slice(11, 16),
          text: `Nueva orden N° ${Number(b.work_order_no) || "—"} recibida (${String(b.customer_name || "Sin nombre")})`,
          bookingId: b.id,
          tone: "sky",
        });
      }
      if (b.status === "ready") {
        const upd = String((b as any).updated_at || b.created_at || "");
        if (upd.slice(0, 10) >= today) {
          items.push({
            id: `r-${b.id}`,
            at: upd,
            time: upd.slice(11, 16),
            text: `Orden N° ${Number(b.work_order_no) || "—"} lista para retirar → WA enviado al cliente`,
            bookingId: b.id,
            tone: "green",
          });
        }
      }
      const due = String(b.delivery_date || "").slice(0, 10);
      if (b.status !== "completed" && b.status !== "cancelled" && due !== "" && due <= today) {
        items.push({
          id: `o-${b.id}`,
          at: String(b.created_at || ""),
          time: "",
          text: `Orden N° ${Number(b.work_order_no) || "—"} vencida (${due.slice(8, 10)}/${due.slice(5, 7)}) — chasar al cliente`,
          bookingId: b.id,
          tone: "red",
        });
      }
    }
    // Presupuestos aceptados hoy (auto-avance de la orden).
    for (const q of quotes || []) {
      const qq = q as any;
      if (qq.status !== "accepted") continue;
      const upd = String(qq.updated_at || qq.created_at || "");
      if (upd.slice(0, 10) !== today) continue;
      const linked = (all as any[]).find((b: any) => String(b.quote_id || "") === String(qq.id || ""));
      items.push({
        id: `q-${qq.id}`,
        at: upd,
        time: upd.slice(11, 16),
        text: `${String(qq.customer_name || "Cliente")} aprobó el presupuesto → orden aprobada`,
        bookingId: linked?.id ?? null,
        tone: "green",
      });
    }
    return items
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 8);
  }, [bookings, quotes, today]);

  const handleDrop = (state: WorkOrderState) => {
    if (!dragId) return;
    const booking = (bookings || []).find((b: any) => b.id === dragId) as any;
    if (booking && booking.status !== state) {
      bookingCardProps.handleUpdateBookingStatus(booking.id, state);
    }
    setDragId(null);
    setDragOverCol(null);
  };

  const showTechFilter = (staff || []).length > 1;

  return (
    <div className="space-y-3">
      {/* Stats clickeables (filtros rápidos) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatChip
          label="En el taller"
          value={stats.inWorkshop}
          active={filter === "all"}
          onClick={() => onFilter("all")}
        />
        <StatChip
          label="Vencidas"
          value={stats.overdue}
          active={filter === "overdue"}
          onClick={() => onFilter("overdue")}
          alert={stats.overdue > 0}
        />
        <StatChip
          label="Listas"
          value={stats.ready}
          active={filter === "ready"}
          onClick={() => onFilter("ready")}
        />
        <StatChip
          label="Por cobrar"
          value={stats.porCobrar}
          active={filter === "pending"}
          onClick={() => onFilter("pending")}
        />
        <StatChip
          label="Recibidas hoy"
          value={stats.recibidasHoy}
          active={filter === "pending"}
          onClick={() => onFilter("pending")}
        />
      </div>

      {/* Barra de filtros + técnico */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip label="Todas" active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterChip label="Recibidas" active={filter === "pending"} onClick={() => onFilter("pending")} />
        <FilterChip label="Listas para retirar" active={filter === "ready"} onClick={() => onFilter("ready")} />
        <FilterChip label="Vencidas / vencen hoy" active={filter === "overdue"} onClick={() => onFilter("overdue")} />
        {showTechFilter && (
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="ml-auto h-7 rounded-full border border-border bg-card px-2 text-xs"
            title="Filtrar por técnico"
          >
            <option value="all">Todos los técnicos</option>
            <option value="unassigned">Sin asignar</option>
            {(staff || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {openOrders.length} orden(es) activa(s)
        </span>
      </div>

      {filter !== "all" && (
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          Filtrando: {filterLabel(filter)}
          <button
            type="button"
            aria-label="Quitar filtro"
            className="rounded-full hover:bg-primary/20 px-1"
            onClick={() => onFilter("all")}
          >
            ✕
          </button>
        </div>
      )}

      {/* Timeline de actividad */}
      {timeline.length > 0 && (
        <details className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">🕒 Actividad reciente</summary>
          <div className="mt-2 space-y-1">
            {timeline.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => it.bookingId && onOpenBooking?.(it.bookingId)}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-muted/50"
              >
                <span className="w-10 shrink-0 font-semibold tabular-nums text-muted-foreground">{it.time || "—"}</span>
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                    it.tone === "green" ? "bg-green-500" : it.tone === "red" ? "bg-red-500" : it.tone === "sky" ? "bg-sky-500" : it.tone === "amber" ? "bg-amber-500" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="min-w-0 flex-1">{it.text}</span>
              </button>
            ))}
          </div>
        </details>
      )}

      {/* Kanban: columnas por estado, scroll horizontal en mobile */}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
        {WORK_ORDER_BOARD_COLUMNS.map((col) => (
          <Column
            key={col}
            state={col}
            items={openOrders.filter((b: any) => b.status === col)}
            filter={filter}
            today={today}
            bookingCardProps={bookingCardProps}
            isDragOver={dragOverCol === col}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverCol(col);
            }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(col);
            }}
            onDragStart={(e, id) => {
              e.dataTransfer.setData("text/plain", id);
              setDragId(id);
            }}
            onOpenBooking={onOpenBooking}
          />
        ))}
      </div>
    </div>
  );
}

function filterLabel(f: WorkOrderBoardFilter): string {
  switch (f) {
    case "pending":
      return "Recibidas";
    case "ready":
      return "Listas para retirar";
    case "overdue":
      return "Vencidas / vencen hoy";
    default:
      return "";
  }
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function StatChip({
  label,
  value,
  active,
  onClick,
  alert,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  alert?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-2 text-center transition-colors ${
        active ? "border-primary bg-primary/10" : alert && value > 0 ? "border-red-200 bg-red-50/50" : "border-border bg-card hover:bg-muted/50"
      }`}
    >
      <p className={`font-display text-lg font-bold ${alert && value > 0 ? "text-red-600" : ""}`}>{value}</p>
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
    </button>
  );
}

function Column({
  state,
  items,
  filter,
  today,
  bookingCardProps,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onOpenBooking,
}: {
  state: WorkOrderState;
  items: Booking[];
  filter: WorkOrderBoardFilter;
  today: string;
  bookingCardProps: Omit<BookingCardProps, "booking">;
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onOpenBooking?: (id: string) => void;
}) {
  const visible =
    filter === "overdue"
      ? items.filter((b: any) => {
          const d = String(b.delivery_date || "").slice(0, 10);
          return d !== "" && d <= today;
        })
      : items;

  const highlighted =
    (filter === "pending" && state === "pending") ||
    (filter === "ready" && state === "ready") ||
    (filter === "overdue" && visible.length > 0);

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-[280px] flex-shrink-0 rounded-xl border bg-card snap-start p-2 space-y-2 transition-colors ${
        isDragOver
          ? "border-primary ring-2 ring-primary/40 bg-primary/5"
          : highlighted
            ? "border-primary ring-1 ring-primary/30"
            : "border-border"
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${workOrderStateTone(state)}`}>
          {workOrderStateLabel(state)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">({visible.length})</span>
      </div>
      <p className="px-1 text-[10px] text-muted-foreground">↕ Arrastrá tarjetas a otra columna para cambiar el estado</p>
      {visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3">Sin órdenes</p>
      ) : (
        visible
          .slice()
          .sort((a: any, b: any) => String(a.booking_date || "") < String(b.booking_date || "") ? -1 : 1)
          .map((b: any) => (
            <div
              key={b.id}
              draggable
              onDragStart={(e) => onDragStart(e, b.id)}
              onClick={(e) => {
                // No abrir el detalle si el click vino de un botón/interactivo.
                if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
                onOpenBooking?.(b.id);
              }}
              className="cursor-pointer"
            >
              <BookingCard booking={b} {...bookingCardProps} />
            </div>
          ))
      )}
    </div>
  );
}
