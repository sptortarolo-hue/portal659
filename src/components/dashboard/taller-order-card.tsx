"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { equipmentLabel } from "@/lib/equipment";
import {
  checklistSummaryLabel,
  hasChecklistContent,
  workOrderDatesLabel,
  workOrderDeliveryDue,
  workOrderNextLabel,
  workOrderQuickActions,
  workOrderStateLabel,
  workOrderStateTone,
  workOrderTitle,
} from "@/lib/work-order";
import { money, orderCostSummary, type WorkOrderPart } from "@/lib/work-order-parts";

type EventRow = {
  id: string;
  kind: string;
  message: string;
  created_at: string;
  actor_name?: string | null;
};

type CatalogProduct = {
  id: string;
  name: string;
  price?: number | null;
  promo_price?: number | null;
  stock?: number | null;
  stock_control?: boolean | null;
};

const EVENT_ICON: Record<string, string> = {
  created: "📥",
  status: "🔄",
  diagnosis: "🔍",
  quote_linked: "🧾",
  quote_sent: "📤",
  quote_approved: "✅",
  parts: "🔩",
  payment: "💰",
  signature: "✍️",
  extended: "📅",
  note: "📝",
};

/**
 * Tarjeta colapsable de orden de servicio para el kanban del taller.
 *
 * Colapsada: muestra el OBJETO primero (grande), estado, falla breve, cliente secundario.
 * Expandida: muestra todo el detalle (diagnóstico, checklist, presupuesto, repuestos,
 * mano de obra, actividad y botones de acción) sin salir del tablero.
 */
export function TallerOrderCard({
  booking,
  bookingCardProps,
  partsCatalog = [],
  onOpenBooking,
}: {
  booking: any;
  bookingCardProps: any;
  partsCatalog?: CatalogProduct[];
  onOpenBooking?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isOrder = booking.kind === "orden";
  const orderNo = booking.work_order_no;
  const orderDates = workOrderDatesLabel(booking.booking_date, booking.delivery_date);
  const orderDeclared = booking.declared_issue || "";
  const orderDiagnosis = booking.diagnosis || "";
  const orderDue = workOrderDeliveryDue(booking.delivery_date, booking.status);
  const equipment = equipmentLabel(booking) || "Sin equipo";
  const servicePrice = Number(booking.service_price || 0);
  const depositPaid = booking.deposit_status === "paid" ? Number(booking.deposit_amount || 0) : 0;
  const balance = Math.max(0, servicePrice - depositPaid);
  const hasAmount = servicePrice > 0 || depositPaid > 0;

  // Presupuesto vinculado
  const linkedQuote =
    (bookingCardProps.orderQuotes || []).find(
      (q: any) => String(q?.id) === String(booking.quote_id || "")
    ) ?? null;

  const quickActions = workOrderQuickActions(booking.status);
  const canCobrar = booking.status !== "cancelled" && booking.status !== "completed";

  // Datos de repuestos/mano de obra (vienen de la API de detalle, pero aquí mostramos lo que hay en la fila)
  const parts: WorkOrderPart[] = booking.parts || [];
  const laborAmount = Number(booking.labor_amount || 0);
  const summary = orderCostSummary({ parts, laborAmount: laborAmount, quotedPrice: booking.service_price });

  // Eventos recientes (últimos 3)
  const events: EventRow[] = booking.events || [];

  return (
    <Card
      className={`border border-border rounded-xl overflow-hidden transition-all duration-200 ${expanded ? "shadow-md ring-1 ring-primary/20" : ""}`}
      onClick={() => {
        if (expanded) setExpanded(false);
        else setExpanded(true);
      }}
      style={{ cursor: expanded ? "default" : "pointer" }}
    >
      {/* CABECERA: siempre visible — objeto primero */}
      <div className="px-3 py-2.5 border-b border-border/50 bg-muted/30">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-display text-sm font-bold truncate">{equipment}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${workOrderStateTone(booking.status)}`}>
                {workOrderStateLabel(booking.status)}
              </span>
              {booking.is_preview && (
                <span className="rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-semibold">🧪</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {orderDeclared || "Sin falla declarada"}
              {orderDue && ` · ${orderDue.text}`}
            </p>
          </div>
          <div className="text-right min-w-[80px]">
            <span className="block text-xs font-semibold text-foreground">
              {workOrderTitle(orderNo)}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {orderDates || "sin fecha"}
            </span>
          </div>
        </div>
        {/* Línea secundaria: cliente + monto + presupuesto */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="flex-1 min-w-0 truncate">
            👤 {booking.customer_name || "Sin cliente"}
          </span>
          {booking.customer_phone && (
            <a
              href={`https://wa.me/${String(booking.customer_phone).replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 hover:underline truncate"
            >
              📲 {booking.customer_phone}
            </a>
          )}
          {hasAmount && (
            <span className="text-right text-[10px] font-mono text-foreground">
              $${servicePrice.toLocaleString("es-AR")}
              {depositPaid > 0 ? ` · seña $${depositPaid.toLocaleString("es-AR")}` : ""}
              {balance > 0 ? ` · saldo $${balance.toLocaleString("es-AR")}` : ""}
            </span>
          )}
          {linkedQuote && (
            <span className={`text-[10px] font-medium ${linkedQuote.status === "accepted" ? "text-green-700" : "text-amber-700"}`}>
              {linkedQuote.status === "accepted" ? "✅ Presupuesto" : "🧾 Presupuesto"}
            </span>
          )}
        </div>
        <span className="absolute top-2 right-2 text-[10px] text-muted-foreground">
          {expanded ? "▲ Cerrar detalle" : "▼ Ver detalle completo"}
        </span>
      </div>

      {/* DETALLE EXPANDIDO */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 text-sm">
          {/* Falla */}
          <div className="rounded-lg border border-border p-2 bg-muted/30">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Falla declarada</p>
            <p className="text-sm">{orderDeclared || "—"}</p>
          </div>

          {/* Diagnóstico */}
          <div className="rounded-lg border border-border p-2 space-y-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Diagnóstico
            </Label>
            <Textarea
              value={orderDiagnosis}
              readOnly
              rows={2}
              className="text-sm bg-background"
              placeholder="Sin diagnóstico registrado"
            />
            {orderDiagnosis ? (
              <p className="text-[10px] text-muted-foreground">Guardado en la ficha de la orden.</p>
            ) : null}
          </div>

          {/* Checklist de ingreso */}
          {hasChecklistContent(booking.intake_checklist) && (
            <div className="rounded-lg border border-border p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Checklist de ingreso</p>
              <p className="text-xs text-muted-foreground">{checklistSummaryLabel(booking.intake_checklist)}</p>
            </div>
          )}

          {/* Presupuesto vinculado */}
          {linkedQuote && (
            <div className="rounded-lg border border-violet-200 bg-violet-50 p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 mb-1">Presupuesto</p>
              <p className="text-sm font-medium">
                {linkedQuote.status === "accepted" ? "✅ Aprobado por el cliente" : "🧾 Enviado — esperando respuesta"}
                {Number(linkedQuote.quoted_price || 0) > 0 ? ` · $${Number(linkedQuote.quoted_price).toLocaleString("es-AR")}` : ""}
              </p>
              <div className="flex gap-1.5 mt-1.5">
                {bookingCardProps.onQuoteOrder && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); bookingCardProps.onQuoteOrder!(booking); }}>
                    💰 Cotizar
                  </Button>
                )}
                {bookingCardProps.onSendOrderQuote && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); bookingCardProps.onSendOrderQuote!(booking); }}>
                    📲 Enviar WA
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Repuestos + mano de obra + margen */}
          <div className="rounded-lg border border-border p-2 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Repuestos y mano de obra</p>
            {parts.length > 0 && (
              <div className="space-y-1">
                {parts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{p.name || "Repuesto"}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground tabular-nums whitespace-nowrap">× {p.qty}</span>
                      <span className="tabular-nums whitespace-nowrap">${money((Number(p.unit_price) || 0) * (Number(p.qty) || 0))}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between text-[11px]">
              <span className="text-muted-foreground">Mano de obra</span>
              <span className="tabular-nums">${money(laborAmount)}</span>
            </div>
            <div className="flex justify-between font-semibold border-t border-border/50 pt-1">
              <span>Total estimado</span>
              <span className="tabular-nums">${money(summary.revenue)}</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Margen estimado</span>
              <span className={`tabular-nums ${summary.margin < 0 ? "text-red-600" : "text-green-700"}`}>
                ${money(summary.margin)}
              </span>
            </div>
          </div>

          {/* Actividad reciente */}
          {events.length > 0 && (
            <div className="rounded-lg border border-border p-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Actividad reciente</p>
              <div className="space-y-1">
                {events.slice(0, 5).map((ev) => (
                  <div key={ev.id} className="flex items-start gap-1.5 text-xs">
                    <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                      {String(ev.created_at || "").slice(11, 16) || "—"}
                    </span>
                    <span className="shrink-0">{EVENT_ICON[ev.kind] || "•"}</span>
                    <span className="min-w-0 flex-1">{ev.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex flex-wrap gap-1.5">
            {canCobrar && bookingCardProps.onCobroBooking && (
              <Button size="sm" className="flex-1 h-8 text-xs" onClick={(e) => { e.stopPropagation(); bookingCardProps.onCobroBooking!(booking.id); }}>
                {booking.status === "ready" ? "💰 Entregar y cobrar" : "💰 Cobrar"}
              </Button>
            )}
            {bookingCardProps.onPrintOrden && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); bookingCardProps.onPrintOrden!(booking.id); }}>
                🖨️ Comprobante
              </Button>
            )}
            {bookingCardProps.onPrintEtiqueta && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); bookingCardProps.onPrintEtiqueta!(booking.id); }}>
                🏷️ Etiqueta
              </Button>
            )}
            {bookingCardProps.onExtendDelivery && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={(e) => { e.stopPropagation(); bookingCardProps.onExtendDelivery!(booking); }}>
                📅 Prorrogar
              </Button>
            )}
            {bookingCardProps.onEditBooking && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={(e) => { e.stopPropagation(); bookingCardProps.onEditBooking!(booking); }}
              >
                ✏️ Editar
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
