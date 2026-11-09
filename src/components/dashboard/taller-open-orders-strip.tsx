"use client";

import type { Booking } from "@/types/database";
import { isOrderBooking } from "@/lib/agenda";
import { isoTodayAR, workOrderStateLabel } from "@/lib/work-order";
import { orderSubjectLabel } from "@/lib/equipment";

/**
 * Banda "En el taller" debajo del calendario de la turnera: TODAS las
 * unidades con orden de servicio abierta, en una sola franja (no bajo cada
 * día del calendario — el calendario es de citas; esto es el tablero del
 * taller). Tocá una para abrir su detalle.
 *
 * Orden: entrega vencida/hoy primero, luego por antigüedad de ingreso.
 */
export function TallerOpenOrdersStrip({
  bookings,
  onOpenBooking,
  max = 8,
}: {
  bookings: Booking[];
  onOpenBooking: (id: string) => void;
  max?: number;
}) {
  const today = isoTodayAR();
  const open = (bookings || [])
    .filter((b: any) => isOrderBooking(b) && b.status !== "completed" && b.status !== "cancelled")
    .sort((a: any, z: any) => {
      const ad = String(a.delivery_date || "");
      const zd = String(z.delivery_date || "");
      const av = ad ? (ad <= today ? 0 : 1) : 2;
      const zv = zd ? (zd <= today ? 0 : 1) : 2;
      if (av !== zv) return av - zv;
      if (ad !== zd) return ad < zd ? -1 : 1;
      return String(a.booking_date || "") < String(z.booking_date || "") ? -1 : 1;
    });

  if (open.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-1.5">
      <p className="text-sm font-semibold text-orange-800">🛠️ En el taller ({open.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {open.slice(0, max).map((b: any) => {
          const eq = orderSubjectLabel(b as any);
          const due = String(b.delivery_date || "");
          const late = due && due <= today;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpenBooking(b.id)}
              className={`rounded-lg border bg-card px-2 py-1 text-left text-[11px] leading-tight hover:bg-muted/50 ${late ? "border-red-300" : "border-border"}`}
            >
              <span className="block font-semibold">
                N° {Number(b.work_order_no) || "—"} · {String(b.customer_name || "Sin nombre")}
              </span>
              <span className="block truncate opacity-80">{eq}</span>
              <span className="block flex items-center gap-1 opacity-80">
                <span>{workOrderStateLabel(b.status)}</span>
                {due && (
                  <span className={late ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                    · entrega {due.slice(8, 10)}/{due.slice(5, 7)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {open.length > max && (
          <span className="self-center px-1 text-[11px] text-muted-foreground">
            +{open.length - max} más
          </span>
        )}
      </div>
    </div>
  );
}
