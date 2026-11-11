"use client";

import { useMemo, useState } from "react";
import type { Booking } from "@/types/database";
import { isOrderBooking } from "@/lib/agenda";
import { isoTodayAR, workOrderStateLabel, workOrderStateTone } from "@/lib/work-order";
import { orderSubjectLabel } from "@/lib/equipment";

export type OrderHistoryStatus = "all" | "completed" | "cancelled";
export type OrderHistoryPeriod = "7" | "30" | "90" | "all";

/**
 * Historial de órdenes de servicio (taller): entregadas y canceladas, con
 * filtros por estado y período (fecha de ingreso) + buscador externo.
 *
 * Se usa en dos lugares: la vista 🕘 Historial del tablero (tab Taller) y el
 * tab Historial del menú (para que el dueño las vea sin entrar al tablero).
 */
export function TallerOrderHistory({
  bookings,
  search = "",
  onOpenBooking,
}: {
  bookings: Booking[];
  /** Texto del buscador del tablero (mismo criterio: N°, cliente, equipo, falla). */
  search?: string;
  onOpenBooking?: (id: string) => void;
}) {
  const [status, setStatus] = useState<OrderHistoryStatus>("all");
  const [period, setPeriod] = useState<OrderHistoryPeriod>("30");

  const items = useMemo(() => {
    let list = (bookings || []).filter(
      (b: any) => isOrderBooking(b) && (b.status === "completed" || b.status === "cancelled")
    );
    if (status !== "all") list = list.filter((b: any) => b.status === status);
    if (period !== "all") {
      const cutoff = new Date(`${isoTodayAR()}T12:00:00`);
      cutoff.setDate(cutoff.getDate() - Number(period));
      const cutoffISO = cutoff.toISOString().slice(0, 10);
      list = list.filter((b: any) => String(b.booking_date || "").slice(0, 10) >= cutoffISO);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((b: any) => {
        const hay = [
          b.work_order_no != null ? `n° ${b.work_order_no}` : "",
          `#${b.work_order_no ?? ""}`,
          b.customer_name,
          b.customer_phone,
          orderSubjectLabel(b),
          b.declared_issue,
          b.diagnosis,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
    // Más recientes primero (por fecha de cierre o ingreso).
    return list.slice().sort((a: any, z: any) => {
      const ac = String(a.completed_at || a.updated_at || a.booking_date || "");
      const zc = String(z.completed_at || z.updated_at || z.booking_date || "");
      return ac < zc ? 1 : -1;
    });
  }, [bookings, status, period, search]);

  const fdate = (iso: string | null | undefined) => {
    const d = String(iso || "").slice(0, 10);
    return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as OrderHistoryStatus)}
          className="h-7 rounded-full border border-border bg-card px-2 text-xs"
          title="Filtrar por estado"
        >
          <option value="all">Todas</option>
          <option value="completed">Entregadas</option>
          <option value="cancelled">Canceladas</option>
        </select>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as OrderHistoryPeriod)}
          className="h-7 rounded-full border border-border bg-card px-2 text-xs"
          title="Filtrar por fecha de ingreso"
        >
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="all">Todo el histórico</option>
        </select>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto whitespace-nowrap">
          {items.length} orden(es)
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-2.5 py-2 font-medium">N°</th>
              <th className="px-2.5 py-2 font-medium">Cliente</th>
              <th className="px-2.5 py-2 font-medium">Equipo / falla</th>
              <th className="px-2.5 py-2 font-medium">Estado</th>
              <th className="px-2.5 py-2 font-medium">Ingreso</th>
              <th className="px-2.5 py-2 font-medium">Cierre</th>
              <th className="px-2.5 py-2 font-medium text-right">Cobro</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2.5 py-6 text-center text-muted-foreground">
                  Sin órdenes en el historial con estos filtros.
                </td>
              </tr>
            ) : (
              items.map((b: any) => {
                const closedISO = String(b.completed_at || b.updated_at || "");
                const subject = orderSubjectLabel(b);
                const total = Number(b.service_price || 0);
                const paid = b.payment_status === "paid";
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
                      {b.declared_issue && (
                        <span className="block max-w-[220px] truncate text-[10px] text-muted-foreground">{String(b.declared_issue)}</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${workOrderStateTone(b.status)}`}>
                        {workOrderStateLabel(b.status)}
                      </span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground">{fdate(b.booking_date)}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-muted-foreground">{fdate(closedISO)}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap">
                      {b.status === "cancelled" ? (
                        <span className="text-[10px] text-muted-foreground">no se cobró</span>
                      ) : total > 0 ? (
                        <>
                          ${total.toLocaleString("es-AR")}
                          {paid && (
                            <span className="block text-[10px] text-green-600">
                              {String(b.payment_method || "cobrado").replace(/_/g, " ")}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
