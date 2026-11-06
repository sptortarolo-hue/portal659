"use client";

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

/**
 * Job board "🛠️ Taller": todas las órdenes de servicio abiertas agrupadas
 * por estado (kanban horizontal de columnas). Dos vistas complementarias:
 * el tablero para trabajar la cola y el chip de filtro para ver solo un
 * estado (o solo las vencidas/que vencen hoy).
 */
export function TallerJobBoard({
  bookings,
  filter,
  onFilter,
  bookingCardProps,
}: {
  bookings: Booking[];
  filter: WorkOrderBoardFilter;
  onFilter: (f: WorkOrderBoardFilter) => void;
  bookingCardProps: Omit<BookingCardProps, "booking">;
}) {
  const today = isoTodayAR();
  const orders = (bookings || []).filter(
    (b: any) => isOrderBooking(b) && b.status !== "completed" && b.status !== "cancelled"
  );

  const filterLabel: Record<WorkOrderBoardFilter, string> = {
    all: "",
    pending: "Recibidas",
    ready: "Listas para retirar",
    overdue: "Vencidas / vencen hoy",
  };

  return (
    <div className="space-y-3">
      {/* Barra de filtros (chips) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip label="Todas" active={filter === "all"} onClick={() => onFilter("all")} />
        <FilterChip label="Recibidas" active={filter === "pending"} onClick={() => onFilter("pending")} />
        <FilterChip label="Listas para retirar" active={filter === "ready"} onClick={() => onFilter("ready")} />
        <FilterChip label="Vencidas / vencen hoy" active={filter === "overdue"} onClick={() => onFilter("overdue")} />
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {orders.length} orden(es) activa(s)
        </span>
      </div>

      {filter !== "all" && filterLabel[filter] && (
        <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
          Filtrando: {filterLabel[filter]}
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

      {/* Kanban: columnas por estado, scroll horizontal en mobile */}
      <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
        {WORK_ORDER_BOARD_COLUMNS.map((col) => (
          <Column
            key={col}
            state={col}
            items={orders.filter((b: any) => b.status === col)}
            filter={filter}
            today={today}
            bookingCardProps={bookingCardProps}
          />
        ))}
      </div>
    </div>
  );
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

function Column({
  state,
  items,
  filter,
  today,
  bookingCardProps,
}: {
  state: WorkOrderState;
  items: Booking[];
  filter: WorkOrderBoardFilter;
  today: string;
  bookingCardProps: Omit<BookingCardProps, "booking">;
}) {
  // Con el filtro "vencidas/vencen hoy" se muestran solo las vencidas en
  // la columna que corresponda (no se inventan tarjetas en otras columnas).
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
      className={`w-[280px] flex-shrink-0 rounded-xl border bg-card snap-start p-2 space-y-2 ${
        highlighted ? "border-primary ring-1 ring-primary/30" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${workOrderStateTone(state)}`}>
          {workOrderStateLabel(state)}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">({visible.length})</span>
      </div>
      {visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3">Sin órdenes</p>
      ) : (
        visible
          .slice()
          .sort((a: any, b: any) => String(a.booking_date || "") < String(b.booking_date || "") ? -1 : 1)
          .map((b: any) => (
            <BookingCard key={b.id} booking={b} {...bookingCardProps} />
          ))
      )}
    </div>
  );
}
