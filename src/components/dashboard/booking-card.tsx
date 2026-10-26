"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Vendor } from "@/types/database";

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
};

/** Tarjeta de un turno con todas sus acciones (detalle en modal y lista). */
export function BookingCard({
  booking,
  formAlerts,
  onNavigate,
  onEditBooking,
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
}: BookingCardProps) {
  // Defensa contra datos basura ("null"/"undefined" de ediciones viejas).
  const nz = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return s === "null" || s === "undefined" ? "" : s;
  };
  const dateOnly = String(booking.booking_date || "").slice(0, 10);
  const productLabel = nz(booking.product_label || booking.product_name);
  const serviceStaffLabel = [nz(booking.service_label), nz(booking.staff_label)].filter(Boolean).join(" · ");
  const notesText = nz(booking.notes);

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
          <p className="text-xs text-muted-foreground">
            {booking.booking_time || "Sin horario"}
            {productLabel && ` · ${productLabel}`}
            {serviceStaffLabel && ` · ${serviceStaffLabel}`}
            {booking.location_label && ` · 📍 ${booking.location_label}`}
            {(booking as any).deposit_status === "paid" ? " · seña pagada ✅" : ""}
            {booking.status === "pending" && (booking as any).deposit_status === "pending" ? " · seña impaga ⏳" : ""}
          </p>
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
        <Badge className={`flex-shrink-0 ${BOOKING_STATUS_COLORS[booking.status] || ""}`}>
          {BOOKING_STATUS_LABELS[booking.status] || booking.status}
        </Badge>
      </div>
      {notesText && (
        <p className="text-xs text-muted-foreground mb-2 italic">
          &quot;{notesText}&quot;
        </p>
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
            {dateOnly <= new Date().toISOString().slice(0, 10) && (
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
        {booking.status === "completed" && (
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
          </>
        )}
        {(booking.status === "pending" || booking.status === "confirmed" || booking.status === "completed") && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            title="Abrir la ficha de la clienta"
            onClick={() => onNavigate?.("clientes")}
          >
            📋 Ficha
          </Button>
        )}
        {(booking.status === "pending" || booking.status === "confirmed" || booking.status === "completed") && onEditBooking && (
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
        {(booking.status === "pending" || booking.status === "confirmed") && (
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
                href={`https://wa.me/${String(booking.customer_phone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hola! Te paso el link de tu turno del ${booking.booking_date} ${String(booking.booking_time).slice(0, 5)}: ${typeof window !== "undefined" ? window.location.origin : ""}/turno/${(booking as any).confirm_token} — confirmalo cuando puedas 👆`)}`}
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
