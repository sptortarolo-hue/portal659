"use client";

import { useMemo, useState } from "react";
import type { Booking } from "@/types/database";
import { isOrderBooking } from "@/lib/agenda";
import { isoTodayAR } from "@/lib/work-order";
import { equipmentLabel } from "@/lib/equipment";

/**
 * Panel "Hoy" del taller: qué hay FÍSICAMENTE en el local (unidades con
 * orden abierta) y los turnos del día. Orden por urgencia: las órdenes con
 * entrega vencida/hoy primero, luego por antigüedad.
 */
export function TallerHoyPanel({
  bookings,
  onOpenBooking,
  onCobroBooking,
  canCobro,
}: {
  bookings: Booking[];
  onOpenBooking: (id: string) => void;
  onCobroBooking?: (id: string) => void;
  canCobro?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const today = isoTodayAR();

  const { openOrders, hoyTurnos } = useMemo(() => {
    const orders = (bookings || [])
      .filter((b: any) => isOrderBooking(b) && b.status !== "completed" && b.status !== "cancelled")
      .map((b: any) => ({ b, due: String(b.delivery_date || "").slice(0, 10) }))
      .sort((a, z) => {
        const av = a.due ? (a.due <= today ? 0 : 1) : 2;
        const zv = z.due ? (z.due <= today ? 0 : 1) : 2;
        if (av !== zv) return av - zv;
        if (a.due !== z.due) return a.due < z.due ? -1 : 1;
        return String(a.b.created_at || "") < String(z.b.created_at || "") ? -1 : 1;
      })
      .map((x) => x.b);
    const turnos = (bookings || [])
      .filter((b: any) => !isOrderBooking(b) && String(b.booking_date || "").slice(0, 10) === today && b.status !== "cancelled")
      .sort((a: any, z: any) =>
        String(a.booking_time || "").localeCompare(String(z.booking_time || "")) ||
        String(a.customer_name || "").localeCompare(String(z.customer_name || ""))
      );
    return { openOrders: orders, hoyTurnos: turnos };
  }, [bookings, today]);

  const visible = showAll ? openOrders : openOrders.slice(0, 5);

  const dueTxt = (iso: string) => {
    if (!iso) return "sin fecha";
    if (iso < today) return `vencida ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    if (iso === today) return "vence hoy";
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  };

  return (
    <div className="space-y-2">
      <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-sm font-semibold text-orange-800 hover:underline text-left"
            title="Ver el tablero del taller"
            onClick={() => window.dispatchEvent(new CustomEvent("portal:go-taller", { detail: { filter: "all" } }))}
          >
            🛠️ En el taller ({openOrders.length})
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-[11px] font-medium text-orange-700 underline"
              title="Ver en el tablero del taller"
              onClick={() => window.dispatchEvent(new CustomEvent("portal:go-taller", { detail: { filter: "all" } }))}
            >
              Ver en Taller →
            </button>
            {openOrders.length > 5 && (
              <button type="button" className="text-[11px] font-medium text-orange-700 underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Ver menos" : `Ver todas (${openOrders.length})`}
              </button>
            )}
          </div>
        </div>
        {openOrders.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay unidades en el taller.</p>
        ) : (
          <div className="space-y-1">
            {visible.map((b: any) => {
              const eq = equipmentLabel(b as any) || String(b.declared_issue || "Equipo sin ficha");
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpenBooking(b.id)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left text-xs hover:bg-muted/50"
                >
                  <span className="w-10 shrink-0 font-semibold tabular-nums text-orange-700">
                    N° {Number(b.work_order_no) || "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{String(b.customer_name || "Sin nombre")}</span>
                    <span className="block truncate text-muted-foreground">{eq}</span>
                  </span>
                  <span className={`shrink-0 text-[10px] ${b.delivery_date && b.delivery_date <= today ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>
                    {dueTxt(b.delivery_date)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {hoyTurnos.length > 0 && (
        <div className="rounded-xl border border-border p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">📅 Turnos de hoy ({hoyTurnos.length})</p>
            <button
              type="button"
              className="text-[11px] font-medium text-primary underline"
              title="Ver el día completo en la agenda"
              onClick={() => window.dispatchEvent(new CustomEvent("portal:go-turnos"))}
            >
              Ver en Turnos →
            </button>
          </div>
          <div className="space-y-1">
            {hoyTurnos.map((b: any) => (
              <button
                key={b.id}
                type="button"
                onClick={() => onOpenBooking(b.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left text-xs hover:bg-muted/50"
              >
                <span className="w-10 shrink-0 font-semibold tabular-nums text-primary">
                  {(b.booking_time || "").slice(0, 5) || "--:--"}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{String(b.customer_name || "Sin nombre")}</span>
                {canCobro && onCobroBooking && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCobroBooking(b.id);
                    }}
                    className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"
                  >
                    💰 Cobrar
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
