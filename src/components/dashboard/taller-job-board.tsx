"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Booking } from "@/types/database";
import { isOrderBooking } from "@/lib/agenda";
import {
  WORK_ORDER_BOARD_COLUMNS,
  isoTodayAR,
  workOrderNextState,
  workOrderStateLabel,
  workOrderStateTone,
  workOrderDeliveryDue,
  type WorkOrderBoardFilter,
  type WorkOrderState,
} from "@/lib/work-order";
import { equipmentFromBooking, orderEquipmentLabel, orderSubjectLabel } from "@/lib/equipment";
import { BookingCard, type BookingCardProps } from "@/components/dashboard/booking-card";
import { TallerOrderCard } from "@/components/dashboard/taller-order-card";

type TimelineItem = {
  id: string;
  at: string; // ISO para ordenar
  time: string; // "09:42"
  text: string;
  bookingId: string | null;
  tone: "green" | "amber" | "sky" | "red" | "muted";
};

type ViewMode = "board" | "list";

/**
 * Job board "🛠️ Taller": pantalla principal del taller (patrón del rubro —
 * RepairDesk/SpokeHub/Orderry). Todas las órdenes abiertas agrupadas por
 * estado, CADA COLUMNA ORDENADA POR FECHA DE ENTREGA (vencidas primero).
 *
 * - Vistas Tablero (kanban con drag & drop) y Lista (tabla densa).
 * - Buscador: N°, cliente, teléfono, equipo (marca/modelo/serie) o falla.
 * - Stats clickeables: En taller / Vencidas / Esperando aprobación /
 *   Listas p/ retirar / Por cobrar / Recibidas hoy.
 * - Filtro por técnico ("mi día") y timeline de actividad.
 * - En mobile, los botones de avance de cada tarjeta cumplen lo mismo que
 *   el drag & drop.
 */
export function TallerJobBoard({
  bookings,
  filter,
  onFilter,
  bookingCardProps,
  onOpenBooking,
  quotes,
  staff,
  partsCatalog,
  onNewOrder,
  onPurgePreview,
}: {
  bookings: Booking[];
  filter: WorkOrderBoardFilter;
  onFilter: (f: WorkOrderBoardFilter) => void;
  bookingCardProps: Omit<BookingCardProps, "booking">;
  onOpenBooking?: (id: string) => void;
  /** Presupuestos del comercio (para la timeline de actividad). */
  quotes?: Record<string, unknown>[];
  /** Profesionales del local (filtro "mi día"). */
  staff?: { id: string; name: string }[];
  /** Catálogo de productos para repuestos en la ficha expandida. */
  partsCatalog?: { id: string; name: string; price?: number | null; promo_price?: number | null; stock?: number | null; stock_control?: boolean | null }[];
  /** Abrir el alta de orden de servicio (recepción de taller). */
  onNewOrder?: () => void;
  /** Borrar órdenes de prueba (is_preview=true). */
  onPurgePreview?: () => void;
}) {
  const today = isoTodayAR();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<WorkOrderState | null>(null);
  const [techFilter, setTechFilter] = useState<string>("all");
  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");

  /** Orden del rubro: por fecha de entrega (vencida primero), "a convenir" al final. */
  function byDelivery(a: any, z: any): number {
    const ad = String(a.delivery_date || "").slice(0, 10);
    const zd = String(z.delivery_date || "").slice(0, 10);
    const av = ad ? (ad < today ? 0 : ad === today ? 1 : 2) : 3;
    const zv = zd ? (zd < today ? 0 : zd === today ? 1 : 2) : 3;
    if (av !== zv) return av - zv;
    if (ad !== zd) return ad < zd ? -1 : 1;
    return String(a.created_at || "") < String(z.created_at || "") ? -1 : 1;
  }

  const matchesSearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return (b: any) => {
      const hay = [
        b.work_order_no != null ? `n° ${b.work_order_no}` : "",
        `#${b.work_order_no ?? ""}`,
        b.customer_name,
        b.customer_phone,
        orderEquipmentLabel(b),
        b.declared_issue,
        b.diagnosis,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    };
  }, [search]);

  const openOrders = useMemo(() => {
    const base = (bookings || []).filter(
      (b: any) =>
        isOrderBooking(b) && b.status !== "completed" && b.status !== "cancelled"
    );
    let list = base;
    if (techFilter !== "all") {
      list = techFilter === "unassigned" ? list.filter((b: any) => !b.staff_id) : list.filter((b: any) => String(b.staff_id || "") === techFilter);
    }
    if (filter === "overdue") {
      list = list.filter((b: any) => {
        const d = String(b.delivery_date || "").slice(0, 10);
        return d !== "" && d <= today;
      });
    } else if (filter === "ready") {
      list = list.filter((b: any) => b.status === "ready");
    } else if (filter === "quoted") {
      list = list.filter((b: any) => b.status === "quoted");
    } else if (filter === "today") {
      list = list.filter((b: any) => String(b.booking_date || "").slice(0, 10) === today);
    } else if (filter === "pending") {
      list = list.filter(
        (b: any) =>
          Number((b as any).service_price || 0) > 0 && (b as any).payment_status !== "paid"
      );
    }
    if (matchesSearch) list = list.filter(matchesSearch);
    return list.slice().sort(byDelivery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, techFilter, filter, matchesSearch, today]);

  const stats = useMemo(() => {
    const all = (bookings || []).filter(
      (b: any) => isOrderBooking(b) && b.status !== "completed" && b.status !== "cancelled"
    );
    return {
      inWorkshop: all.length,
      overdue: all.filter((b: any) => {
        const d = String(b.delivery_date || "").slice(0, 10);
        return d !== "" && d <= today;
      }).length,
      quoted: all.filter((b: any) => b.status === "quoted").length,
      ready: all.filter((b: any) => b.status === "ready").length,
      porCobrar: all.filter(
        (b: any) =>
          Number((b as any).service_price || 0) > 0 && (b as any).payment_status !== "paid"
      ).length,
      recibidasHoy: all.filter((b: any) => String(b.booking_date || "").slice(0, 10) === today).length,
    };
  }, [bookings, today]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    const all = bookings || [];
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
            text: `Orden N° ${Number(b.work_order_no) || "—"} lista para retirar → aviso enviado al cliente`,
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
          text: `Orden N° ${Number(b.work_order_no) || "—"} vencida (${due.slice(8, 10)}/${due.slice(5, 7)}) — avisar al cliente`,
          bookingId: b.id,
          tone: "red",
        });
      }
    }
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
  const previewOrdens = bookings.filter((b: any) => b?.is_preview === true && isOrderBooking(b));

  return (
    <div className="space-y-3">
      {/* Stats clickeables (filtros rápidos) */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatChip label="En taller" value={stats.inWorkshop} active={filter === "all"} onClick={() => onFilter("all")} />
        <StatChip label="Vencidas" value={stats.overdue} active={filter === "overdue"} onClick={() => onFilter("overdue")} alert={stats.overdue > 0} />
        <StatChip label="Esperando aprobación" value={stats.quoted} active={filter === "quoted"} onClick={() => onFilter("quoted")} warn={stats.quoted > 0} />
        <StatChip label="Listas" value={stats.ready} active={filter === "ready"} onClick={() => onFilter("ready")} />
        <StatChip label="Por cobrar" value={stats.porCobrar} active={filter === "pending"} onClick={() => onFilter("pending")} />
        <StatChip label="Recibidas hoy" value={stats.recibidasHoy} active={filter === "today"} onClick={() => onFilter("today")} />
      </div>

      {/* Borrar órdenes de prueba */}
      {previewOrdens.length > 0 && onPurgePreview && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 space-y-1.5">
          <p className="text-[11px] font-semibold text-amber-800 mb-1">
            ⚠️ {previewOrdens.length} orden(es) de prueba
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs text-amber-700"
            onClick={onPurgePreview}
          >
            Borrar órdenes de prueba
          </Button>
        </div>
      )}

      {/* Barra: vistas + buscador + técnico */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setView("board")}
            className={`px-2.5 py-1 text-xs font-medium ${view === "board" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
          >
            ▦ Tablero
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`px-2.5 py-1 text-xs font-medium ${view === "list" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
          >
            ☰ Lista
          </button>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar N°, cliente, teléfono, equipo o falla..."
          className="h-7 min-w-0 flex-1 max-w-[280px] rounded-full border border-border bg-card px-3 text-xs"
        />
        {showTechFilter && (
          <select
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="h-7 rounded-full border border-border bg-card px-2 text-xs"
            title="Filtrar por técnico"
          >
            <option value="all">Todos los técnicos</option>
            <option value="unassigned">Sin asignar</option>
            {(staff || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-2">
          {onNewOrder && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-orange-300 text-orange-700"
              onClick={onNewOrder}
            >
              🛠️ ＋ Nueva orden
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
            {openOrders.length} orden(es) activa(s)
          </span>
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

      {view === "board" ? (
        /* Kanban: columnas por estado, scroll horizontal en mobile */
        <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
          {WORK_ORDER_BOARD_COLUMNS.map((col) => {
            const items = openOrders.filter((b: any) => b.status === col);
            return (
              <Column
                key={col}
                state={col}
                items={items}
                bookingCardProps={bookingCardProps}
                partsCatalog={partsCatalog}
                isDragOver={dragOverCol === col}
                highlighted={filter === col}
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
            );
          })}
        </div>
      ) : (
        /* Lista: tabla densa (RepairDesk), ideal para recepcionar de frente */
        <OrderList
          items={openOrders}
          today={today}
          bookingCardProps={bookingCardProps}
          onOpenBooking={onOpenBooking}
        />
      )}
    </div>
  );
}

function filterLabel(f: WorkOrderBoardFilter): string {
  switch (f) {
    case "pending":
      return "Por cobrar";
    case "ready":
      return "Listas para retirar";
    case "overdue":
      return "Vencidas / vencen hoy";
    case "quoted":
      return "Esperando aprobación";
    case "today":
      return "Recibidas hoy";
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

void FilterChip;

function StatChip({
  label,
  value,
  active,
  onClick,
  alert,
  warn,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  alert?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-2 text-center transition-colors ${
        active
          ? "border-primary bg-primary/10"
          : alert && value > 0
            ? "border-red-200 bg-red-50/50"
            : warn && value > 0
              ? "border-amber-200 bg-amber-50/50"
              : "border-border bg-card hover:bg-muted/50"
      }`}
    >
      <p className={`font-display text-lg font-bold ${alert && value > 0 ? "text-red-600" : warn && value > 0 ? "text-amber-600" : ""}`}>{value}</p>
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
    </button>
  );
}

function OrderList({
  items,
  today,
  bookingCardProps,
  onOpenBooking,
}: {
  items: Booking[];
  today: string;
  bookingCardProps: Omit<BookingCardProps, "booking">;
  onOpenBooking?: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-2.5 py-2 font-medium">N°</th>
            <th className="px-2.5 py-2 font-medium">Cliente</th>
            <th className="px-2.5 py-2 font-medium">Equipo / falla</th>
            <th className="px-2.5 py-2 font-medium">Estado</th>
            <th className="px-2.5 py-2 font-medium">Entrega</th>
            <th className="px-2.5 py-2 font-medium text-right">Total</th>
            <th className="px-2.5 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-2.5 py-6 text-center text-muted-foreground">
                Sin órdenes que coincidan.
              </td>
            </tr>
          ) : (
            items.map((b: any) => {
              const due = workOrderDeliveryDue(b.delivery_date, b.status);
              const next = workOrderNextState(b.status);
              const total = Number(b.service_price || 0);
              // Título: el equipo si tiene ficha; si no, lo que vino a hacer.
              const subject = orderSubjectLabel(b);
              const eqFilled = subject !== String(b.declared_issue || "").trim();
              return (
                <tr
                  key={b.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40 cursor-pointer"
                  onClick={() => onOpenBooking?.(b.id)}
                >
                  <td className="px-2.5 py-2 font-semibold tabular-nums">N° {Number(b.work_order_no) || "—"}</td>
                  <td className="px-2.5 py-2">
                    <span className="block max-w-[140px] truncate font-medium">{b.customer_name || "Sin nombre"}</span>
                    {b.customer_phone && <span className="block text-[10px] text-muted-foreground">{b.customer_phone}</span>}
                  </td>
                  <td className="px-2.5 py-2">
                    <span className="block max-w-[220px] truncate">{subject}</span>
                    {eqFilled && b.declared_issue && (
                      <span className="block max-w-[220px] truncate text-[10px] text-muted-foreground">{String(b.declared_issue)}</span>
                    )}
                    {!eqFilled && (
                      <span className="block max-w-[220px] truncate text-[10px] text-muted-foreground">Equipo sin ficha</span>
                    )}
                  </td>
                  <td className="px-2.5 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${workOrderStateTone(b.status)}`}>
                      {workOrderStateLabel(b.status)}
                    </span>
                  </td>
                  <td className={`px-2.5 py-2 whitespace-nowrap ${due?.tone || "text-muted-foreground"}`}>
                    {due?.text || (b.delivery_date ? String(b.delivery_date).slice(8, 10) + "/" + String(b.delivery_date).slice(5, 7) : "a convenir")}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">
                    {total > 0 ? `$${total.toLocaleString("es-AR")}` : "—"}
                    {b.payment_status === "paid" && <span className="block text-[10px] text-green-600">cobrado</span>}
                  </td>
                  <td className="px-2.5 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {next && (
                      <button
                        type="button"
                        onClick={() => bookingCardProps.handleUpdateBookingStatus(b.id, next)}
                        className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium hover:bg-muted"
                        title={`Avanzar a ${workOrderStateLabel(next)}`}
                      >
                        → {workOrderStateLabel(next)}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

void FilterChip;

function Column({
  state,
  items,
  bookingCardProps,
  partsCatalog,
  isDragOver,
  highlighted,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onOpenBooking,
}: {
  state: WorkOrderState;
  items: Booking[];
  bookingCardProps: Omit<BookingCardProps, "booking">;
  partsCatalog?: { id: string; name: string; price?: number | null; promo_price?: number | null; stock?: number | null; stock_control?: boolean | null }[];
  isDragOver: boolean;
  highlighted: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onOpenBooking?: (id: string) => void;
}) {
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
        <span className="text-[11px] text-muted-foreground tabular-nums">({items.length})</span>
      </div>
      <p className="px-1 text-[10px] text-muted-foreground">↕ Arrastrá tarjetas a otra columna para cambiar el estado</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center py-3">Sin órdenes</p>
      ) : (
        items.map((b: any) => (
          <div
            key={b.id}
            draggable
            onDragStart={(e) => onDragStart(e, b.id)}
            className="cursor-pointer"
          >
            <TallerOrderCard
              booking={b}
              bookingCardProps={bookingCardProps}
              partsCatalog={partsCatalog}
              onOpenBooking={onOpenBooking}
            />
          </div>
        ))
      )}
    </div>
  );
}
