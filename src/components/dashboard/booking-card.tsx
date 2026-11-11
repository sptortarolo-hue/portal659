"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Vendor } from "@/types/database";
import { bookingReminderMessage, bookingWhenLabel } from "@/lib/booking-message";
import { isOrderBooking } from "@/lib/agenda";
import { orderEquipmentLabel } from "@/lib/equipment";
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

export const BOOKING_STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  confirmed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
  noshow: "bg-orange-100 text-orange-700",
};

export const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  noshow: "Ausente",
};

export function waLinkFor(phone: unknown): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export type BookingCardProps = {
  booking: any;
  formAlerts: Record<string, { template: string; session_no: number; labels: string[] }[]>;
  onNavigate?: (section: "orders" | "pos" | "caja" | "config" | "pedidos" | "clientes") => void;
  onEditBooking?: (booking: any) => void;
  /** Abre la modal de ficha de la clienta (datos + sesiones anteriores + carga de ficha de la última sesión). */
  onFichaBooking?: (id: string) => void;
  editingProductsId: string | null;
  setEditingProductsId: (id: string | null) => void;
  productsText: string;
  setProductsText: (v: string) => void;
  productsBusy: boolean;
  handleSaveProducts: (id: string) => void;
  handleUpdateBookingStatus: (id: string, status: string) => void;
  setRebook: (r: {
    customerName: string;
    customerPhone: string;
    serviceId: string;
    staffId: string;
    durationMin: number;
    date?: string;
  }) => void;
  setBookingModalOpen: (v: boolean) => void;
  confirmLinkBusy: string | null;
  handleConfirmLink: (id: string, existingToken?: string | null) => void;
  canDeposits: boolean;
  canFiscal?: boolean;
  fiscalReady?: boolean;
  vendor: Vendor | null;
  stripeBookingLink: Record<string, string>;
  stripeBookingBusy: string | null;
  handleBookingStripeDepositLink: (id: string) => void;
  mpBookingLink: Record<string, string>;
  mpBookingBusy: string | null;
  handleBookingMpDepositLink: (id: string) => void;
  /** Abre el modal de cobro del turno (saldo tras descontar seña). */
  onCobroBooking?: (id: string) => void;
  cobroOpenId?: string | null;
  /** Orden de servicio: imprime el comprobante del cliente (80mm). */
  onPrintOrden?: (id: string) => void;
  /** Turno cobrado: imprime el comprobante de servicio (80mm). */
  onPrintTurno?: (id: string) => void;
  /** Orden de servicio: imprime la etiqueta para el equipo (58mm). */
  onPrintEtiqueta?: (id: string) => void;
  /** Orden de servicio: prorroga la fecha de entrega (modal interna). */
  onExtendDelivery?: (booking: any) => void;
  /** Orden de servicio: abre el modal para cotizarla. */
  onQuoteOrder?: (booking: any) => void;
  /** Orden de servicio: envía el presupuesto vinculado por WhatsApp. */
  onSendOrderQuote?: (booking: any) => void;
  /** Presupuestos del comercio (para mostrar el vinculado a la orden). */
  orderQuotes?: any[];
  /** Ids con impresión en curso (deshabilita los botones). */
  printBusyId?: string | null;
  /** Taller: desde un turno, generar una orden de servicio con sus datos. */
  onGenerateOrder?: (booking: any) => void;
};

/** Tarjeta de un turno con todas sus acciones (detalle en modal y lista). */
export function BookingCard({
  booking,
  formAlerts,
  onNavigate,
  onEditBooking,
  onFichaBooking,
  editingProductsId,
  setEditingProductsId,
  productsText,
  setProductsText,
  productsBusy,
  handleSaveProducts,
  handleUpdateBookingStatus,
  setRebook,
  setBookingModalOpen,
  confirmLinkBusy,
  handleConfirmLink,
  canDeposits,
  canFiscal,
  fiscalReady,
  vendor,
  stripeBookingLink,
  stripeBookingBusy,
  handleBookingStripeDepositLink,
  mpBookingLink,
  mpBookingBusy,
  handleBookingMpDepositLink,
  onCobroBooking,
  cobroOpenId,
  onPrintOrden,
  onPrintEtiqueta,
  onPrintTurno,
  onExtendDelivery,
  onQuoteOrder,
  onSendOrderQuote,
  orderQuotes,
  printBusyId,
  onGenerateOrder,
}: BookingCardProps) {
  // Defensa contra datos basura ("null"/"undefined" de ediciones viejas).
  const nz = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return s === "null" || s === "undefined" ? "" : s;
  };
  // "Productos usados" (texto libre) es de estética: en taller los insumos se
  // cargan como repuestos reales de la orden, así que el campo no se muestra.
  const isTaller = (vendor as any)?.vertical === "taller";
  const dateOnly = String(booking.booking_date || "").slice(0, 10);
  const productLabel = nz(booking.product_label || booking.product_name);
  const serviceStaffLabel = [nz(booking.service_label), nz(booking.staff_label)].filter(Boolean).join(" · ");
  const notesText = nz(booking.notes);
  // Orden de servicio (recepción de taller): sin hora, con fecha de entrega.
  const isOrder = isOrderBooking(booking);
  const orderNo = (booking as any).work_order_no;
  const orderDates = isOrder ? workOrderDatesLabel(booking.booking_date, (booking as any).delivery_date) : "";
  const orderDue = isOrder ? workOrderDeliveryDue((booking as any).delivery_date, booking.status) : null;
  const orderDeclared = isOrder ? nz((booking as any).declared_issue) : "";
  const eqOrder = isOrder ? orderEquipmentLabel(booking as never) : "";
  const orderDiagnosis = isOrder ? nz((booking as any).diagnosis) : "";
  const nextLabel = isOrder ? workOrderNextLabel(booking.status) : "";
  // Presupuesto vinculado a la orden (para mostrar y enviar por WhatsApp).
  const linkedQuote = isOrder
    ? (orderQuotes || []).find((q: any) => String(q?.id) === String(booking.quote_id || "")) ?? null
    : null;
  const actionStatuses = isOrder
    ? ["pending", "diagnosed", "quoted", "approved", "repairing", "waiting_parts", "ready", "completed"]
    : ["pending", "confirmed", "completed"];

  const servicePrice = Number((booking as any).service_price || 0);
  const depositPaid =
    (booking as any).deposit_status === "paid" ? Number((booking as any).deposit_amount || 0) : 0;
  const balance = Math.max(0, servicePrice - depositPaid);
  const hasAmount = servicePrice > 0 || depositPaid > 0;

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">
            {booking.customer_name || "Sin nombre"}
          </p>
          {isOrder ? (
            <>
              <p className="text-xs font-semibold text-orange-700">
                {workOrderTitle(orderNo)} · {orderDates || "sin fecha de entrega"}
              </p>
              {eqOrder && (
                <p className="text-xs text-foreground/90 mt-0.5">🛠️ {eqOrder}</p>
              )}
              {!eqOrder && orderDeclared && (
                <p className="text-xs text-foreground/90 mt-0.5">🛠️ {orderDeclared}</p>
              )}
              {orderDeclared && (
                <p className="text-xs text-foreground/90 mt-0.5">
                  <span className="text-muted-foreground">Falla: </span>
                  {orderDeclared}
                </p>
              )}
              {orderDiagnosis && (
                <p className="text-xs text-foreground/90 mt-0.5">
                  <span className="text-muted-foreground">Diagnóstico: </span>
                  {orderDiagnosis}
                </p>
              )}
              {hasChecklistContent((booking as any).intake_checklist) && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  📋 {checklistSummaryLabel((booking as any).intake_checklist)}
                </p>
              )}
              {linkedQuote && (
                <p className={`text-xs mt-0.5 font-medium ${linkedQuote.status === "accepted" ? "text-green-700" : linkedQuote.status === "responded" ? "text-violet-700" : "text-amber-700"}`}>
                  {linkedQuote.status === "accepted"
                    ? `✅ Presupuesto aprobado · $${Number(linkedQuote.quoted_price || 0).toLocaleString("es-AR")}`
                    : linkedQuote.status === "responded"
                      ? `🧾 Presupuesto enviado · $${Number(linkedQuote.quoted_price || 0).toLocaleString("es-AR")}`
                      : "🧾 Presupuesto borrador"}
                </p>
              )}
              {!linkedQuote && (booking as any).service_price != null && Number((booking as any).service_price) > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  💲 Precio estimado: ${Number((booking as any).service_price).toLocaleString("es-AR")}
                </p>
              )}
              {orderDue && <p className={`text-xs mt-0.5 ${orderDue.tone}`}>📦 {orderDue.text}</p>}
              {(booking as any).deposit_status === "paid" ? (
                <p className="text-xs text-muted-foreground">seña pagada ✅</p>
              ) : (booking as any).deposit_status === "pending" ? (
                <p className="text-xs text-amber-600">seña impaga ⏳</p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {booking.booking_time || "Sin horario"}
              {productLabel && ` · ${productLabel}`}
              {serviceStaffLabel && ` · ${serviceStaffLabel}`}
              {booking.location_label && ` · 📍 ${booking.location_label}`}
              {(booking as any).deposit_status === "paid" ? " · seña pagada ✅" : ""}
              {booking.status === "pending" && (booking as any).deposit_status === "pending" ? " · seña impaga ⏳" : ""}
            </p>
          )}
          {hasAmount && booking.status !== "completed" && (
            <p className="text-xs text-muted-foreground mb-1">
              Total $${servicePrice.toLocaleString("es-AR")}
              {depositPaid > 0 ? ` · seña pagada $${depositPaid.toLocaleString("es-AR")}` : ""}
              {balance > 0 ? ` · saldo $${balance.toLocaleString("es-AR")}` : ""}
            </p>
          )}
          {booking.status === "completed" && (
            <p className="text-xs text-muted-foreground mb-1">
              Atendido · cobrado {nz((booking as any).payment_method)} $${Number((booking as any).amount_paid || 0).toLocaleString("es-AR")}
            </p>
          )}
          {booking.customer_phone && (
            <a
              href={waLinkFor(booking.customer_phone) || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-green-600 font-medium hover:underline"
            >
              📲 {booking.customer_phone}
            </a>
          )}
        </div>
        {(booking as any).is_preview && (
          <span className="flex-shrink-0 rounded-full bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[10px] font-semibold">
            🧪 PRUEBA
          </span>
        )}
        <Badge className={`flex-shrink-0 ${isOrder ? workOrderStateTone(booking.status) : BOOKING_STATUS_COLORS[booking.status] || ""}`}>
          {isOrder ? workOrderStateLabel(booking.status) : BOOKING_STATUS_LABELS[booking.status] || booking.status}
        </Badge>
      </div>
      {notesText && (
        <p className="text-xs text-muted-foreground mb-2 italic">
          &quot;{notesText}&quot;
        </p>
      )}
      {isOrder && (booking as any).equipment_photo_url && (
        <div className="mb-2 overflow-hidden rounded-lg border border-border">
          <img
            src={String((booking as any).equipment_photo_url)}
            alt="Foto de recepción del equipo"
            className="max-h-40 w-full object-cover"
          />
          <p className="bg-card px-2 py-1 text-[10px] text-muted-foreground">📷 Foto de recepción</p>
        </div>
      )}
      {(() => {
        const alerts = (booking.customer_phone && formAlerts[String(booking.customer_phone)]) || [];
        if (alerts.length === 0) return null;
        const labels = [...new Set(alerts.flatMap((a: { labels: string[] }) => a.labels))];
        return (
          <button
            type="button"
            onClick={() => onNavigate?.("clientes")}
            title="Ver ficha de la clienta"
            className="block w-full text-left text-xs mb-2 rounded-lg bg-red-50 border border-red-200 px-2.5 py-1.5 text-red-800 hover:bg-red-100"
          >
            🚨 {labels.join(" · ")} — ver ficha →
          </button>
        );
      })()}
      {!isTaller && (
        <>
          {(booking as any).products_used && editingProductsId !== booking.id && (
            <p className="text-xs text-muted-foreground mb-2">
              🧴 <span className="italic">{String((booking as any).products_used)}</span>
            </p>
          )}
          {editingProductsId === booking.id ? (
            <div className="mb-2 space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">🧴 Productos utilizados (quedan en la ficha)</Label>
              <Textarea
                value={productsText}
                onChange={(e) => setProductsText(e.target.value)}
                placeholder="Ej: Tinte Koleston 7/0 + oxidante 20v"
                rows={2}
                className="text-xs"
              />
          <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={productsBusy} onClick={() => handleSaveProducts(booking.id)}>
                {productsBusy ? "Guardando..." : "Guardar"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingProductsId(null)}>
                Cerrar
              </Button>
            </div>
            </div>
          ) : (
            booking.status === "confirmed" && (
              <button
                type="button"
                onClick={() => { setEditingProductsId(booking.id); setProductsText(String((booking as any).products_used || "")); }}
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline mb-2"
              >
                {(booking as any).products_used ? "✏️ Editar productos" : "＋ Anotar productos usados"}
              </button>
            )
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {booking.status === "pending" && (
          <>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => handleUpdateBookingStatus(booking.id, "confirmed")}
            >
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-red-600"
              onClick={() => handleUpdateBookingStatus(booking.id, "cancelled")}
            >
              Cancelar
            </Button>
          </>
        )}
        {booking.status === "confirmed" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-red-600"
              onClick={() => handleUpdateBookingStatus(booking.id, "cancelled")}
            >
              Cancelar
            </Button>
            {!isOrder && dateOnly <= new Date().toISOString().slice(0, 10) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-amber-600"
                title="El cliente no vino (queda en su historial)"
                onClick={() => handleUpdateBookingStatus(booking.id, "noshow")}
              >
                No vino
              </Button>
            )}
            {onCobroBooking && (
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={cobroOpenId === booking.id}
                onClick={() => onCobroBooking(booking.id)}
              >
                {cobroOpenId === booking.id ? "Cobrando…" : "💰 Cobrar servicio"}
              </Button>
            )}
            {onGenerateOrder && !isOrder && (booking.status === "pending" || booking.status === "confirmed") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                title="Crear una orden de servicio con los datos de este turno (equipo, cliente y falla)"
                onClick={() => onGenerateOrder(booking)}
              >
                🛠️ Generar orden
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              title="Agendar el próximo turno con los mismos datos"
              onClick={() => {
                setRebook({
                  customerName: String(booking.customer_name || ""),
                  customerPhone: String(booking.customer_phone || ""),
                  serviceId: typeof booking.service_id === "string" ? booking.service_id : "",
                  staffId: typeof booking.staff_id === "string" ? booking.staff_id : "",
                  durationMin: Number(booking.duration_min) || 60,
                });
                setBookingModalOpen(true);
              }}
            >
              🔁 Repetir
            </Button>
          </>
        )}
        {isOrder && (
          <>
            {workOrderQuickActions(booking.status).length > 0 && (
              <div className="flex flex-wrap gap-1" title={nextLabel ? `Próximo paso: ${nextLabel}` : undefined}>
                {workOrderQuickActions(booking.status).map((a) => (
                  <Button
                    key={a.to}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    title={`Marcar como ${workOrderStateLabel(a.to)}`}
                    onClick={() => handleUpdateBookingStatus(booking.id, a.to)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
            {onPrintOrden && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={printBusyId === booking.id}
                title="Imprimir el comprobante para el cliente (80mm)"
                onClick={() => onPrintOrden(booking.id)}
              >
                🖨️ Comprobante
              </Button>
            )}
            {onPrintEtiqueta && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={printBusyId === booking.id}
                title="Imprimir la etiqueta para el equipo (58mm)"
                onClick={() => onPrintEtiqueta(booking.id)}
              >
                🏷️ Etiqueta
              </Button>
            )}
            {onQuoteOrder && booking.status !== "cancelled" && booking.status !== "completed" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                title={linkedQuote ? "Re-cotizar (el costo cambió durante la reparación)" : "Cotizar con materiales y mano de obra antes de reparar"}
                onClick={() => onQuoteOrder(booking)}
              >
                {linkedQuote ? "💰 Re-cotizar" : "💰 Cotizar"}
              </Button>
            )}
            {linkedQuote && (
              <>
                <p className="w-full text-xs text-muted-foreground">
                  Presupuesto: <strong className="text-foreground">${Number(linkedQuote.quoted_price || 0).toLocaleString("es-AR")}</strong>
                  {linkedQuote.status === "accepted" ? " · aprobado ✅" : linkedQuote.status === "responded" ? " · enviado" : " · borrador"}
                </p>
                {onSendOrderQuote && linkedQuote.status !== "accepted" && booking.status !== "cancelled" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-green-600"
                    title="Enviar el presupuesto al cliente por WhatsApp"
                    onClick={() => onSendOrderQuote(booking)}
                  >
                    📲 Enviar presupuesto
                  </Button>
                )}
              </>
            )}
            {onExtendDelivery && booking.status !== "cancelled" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                title="Prorrogar la fecha de entrega y avisar al cliente"
                onClick={() => onExtendDelivery(booking)}
              >
                📅 Prorrogar entrega
              </Button>
            )}
            {onCobroBooking && (servicePrice > 0 || depositPaid > 0) && booking.status !== "cancelled" && (
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={cobroOpenId === booking.id}
                onClick={() => onCobroBooking(booking.id)}
              >
                {cobroOpenId === booking.id ? "Cobrando…" : "💰 Cobrar servicio"}
              </Button>
            )}
            {/* Cancelar la orden (queda en el historial, no se borra). */}
            {booking.status !== "cancelled" && booking.status !== "completed" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs text-red-600"
                title="Cancelar la orden (queda en el historial)"
                onClick={() => {
                  const no = Number((booking as any).work_order_no) || 0;
                  if (window.confirm(no ? `¿Cancelar la orden N° ${no} de ${booking.customer_name || "sin nombre"}?` : `¿Cancelar esta orden?`)) {
                    handleUpdateBookingStatus(booking.id, "cancelled");
                  }
                }}
              >
                🚫 Cancelar orden
              </Button>
            )}
          </>
        )}
        {booking.status === "completed" && !isOrder && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              title="Agendar el próximo turno con los mismos datos"
              onClick={() => {
                setRebook({
                  customerName: String(booking.customer_name || ""),
                  customerPhone: String(booking.customer_phone || ""),
                  serviceId: typeof booking.service_id === "string" ? booking.service_id : "",
                  staffId: typeof booking.staff_id === "string" ? booking.staff_id : "",
                  durationMin: Number(booking.duration_min) || 60,
                });
                setBookingModalOpen(true);
              }}
            >
              🔁 Repetir
            </Button>
            {(booking as any).payment_status === "paid" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                title="Ver comprobante emitido"
                onClick={() => onNavigate?.("caja")}
              >
                🧾 Comprobante
              </Button>
            )}
            {onPrintTurno && (booking as any).payment_status === "paid" && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={printBusyId === booking.id}
                title="Imprimir el comprobante de servicio (recibo del turno)"
                onClick={() => onPrintTurno(booking.id)}
              >
                {printBusyId === booking.id ? "Imprimiendo..." : "🖨️ Imprimir"}
              </Button>
            )}
          </>
        )}
        {actionStatuses.includes(booking.status) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            title="Abrir la ficha de la clienta"
            onClick={() => (onFichaBooking ? onFichaBooking(booking.id) : onNavigate?.("clientes"))}
          >
            📋 Ficha
          </Button>
        )}
        {actionStatuses.includes(booking.status) && onEditBooking && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            title="Editar fecha, horario, profesional o datos del turno"
            onClick={() => onEditBooking(booking)}
          >
            ✏️ Editar
          </Button>
        )}
        {!isOrder && (booking.status === "pending" || booking.status === "confirmed") && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              title="Link para que la clienta confirme o cancele sola"
              disabled={confirmLinkBusy === booking.id}
              onClick={() => handleConfirmLink(booking.id, typeof (booking as any).confirm_token === "string" ? (booking as any).confirm_token : null)}
            >
              {confirmLinkBusy === booking.id ? "Generando..." : "🔗 Link"}
            </Button>
            {typeof (booking as any).confirm_token === "string" && (booking as any).confirm_token && booking.customer_phone && (
              <a
                href={`https://wa.me/${String(booking.customer_phone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(bookingReminderMessage({
                  customerName: booking.customer_name,
                  when: bookingWhenLabel(booking.booking_date),
                  time: booking.booking_time,
                  storeName: vendor?.store_name,
                  origin: typeof window !== "undefined" ? window.location.origin : "",
                  token: (booking as any).confirm_token,
                }))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center h-7 px-2 rounded-md border border-input text-xs font-medium text-green-600 hover:bg-muted"
              >
                📲 Enviar
              </a>
            )}
          </>
        )}
          {canDeposits && vendor?.stripe_account_id && Number((booking as any).deposit_amount) > 0 && (booking as any).deposit_status !== "paid" && (booking.status === "pending" || booking.status === "confirmed") && (
            <div className="min-w-0">
            {(booking as any).deposit_status === "paid" ? null : stripeBookingLink[booking.id] ? (
              <div className="flex items-center gap-2">
                <Input value={stripeBookingLink[booking.id]} readOnly className="h-7 text-[11px] flex-1" onFocus={(e) => e.target.select()} />
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hola, te paso el link para la seña del turno ($${Number((booking as any).deposit_amount).toLocaleString("es-AR")}): ${stripeBookingLink[booking.id]}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-green-600 hover:underline"
                >
                  📲 Enviar
                </a>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={stripeBookingBusy === booking.id}
                onClick={() => handleBookingStripeDepositLink(booking.id)}
              >
                {stripeBookingBusy === booking.id ? "Generando..." : `💳 Link seña $${Number((booking as any).deposit_amount).toLocaleString("es-AR")}`}
              </Button>
            )}
          </div>
        )}
          {canDeposits && vendor?.mp_user_id && Number((booking as any).deposit_amount) > 0 && (booking as any).deposit_status !== "paid" && (booking.status === "pending" || booking.status === "confirmed") && (
            <div className="min-w-0">
            {mpBookingLink[booking.id] ? (
              <div className="flex items-center gap-2">
                <Input value={mpBookingLink[booking.id]} readOnly className="h-7 text-[11px] flex-1" onFocus={(e) => e.target.select()} />
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Hola, te paso el link para la seña del turno ($${Number((booking as any).deposit_amount).toLocaleString("es-AR")}): ${mpBookingLink[booking.id]}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-green-600 hover:underline"
                >
                  📲 Enviar
                </a>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={mpBookingBusy === booking.id}
                onClick={() => handleBookingMpDepositLink(booking.id)}
              >
                {mpBookingBusy === booking.id ? "Generando..." : `🔗 Link MP $${Number((booking as any).deposit_amount).toLocaleString("es-AR")}`}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
