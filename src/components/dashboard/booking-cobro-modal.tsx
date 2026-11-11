"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isFromPricing } from "@/lib/service-price";

export type BookingCobroModalProps = {
  booking: any;
  /** Servicio del turno (para saber si el precio es "desde" y el final se define al cobrar). */
  service?: { price?: number | null; price_from?: number | null; price_to?: number | null } | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  canFiscal?: boolean;
  fiscalReady?: boolean;
  /** Orden de servicio (taller): cambia el título y ofrece imprimir el comprobante al cobrar. */
  isOrder?: boolean;
};

function fmt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString("es-AR");
}

export function BookingCobroModal({
  booking,
  service,
  open,
  onClose,
  onSuccess,
  canFiscal = false,
  fiscalReady = false,
  isOrder = false,
}: BookingCobroModalProps) {
  const snapshotTotal = Number(booking.service_price || 0);
  const depositPaid =
    booking.deposit_status === "paid" ? Number(booking.deposit_amount || 0) : 0;
  const fromPricing = service ? isFromPricing(service) : false;

  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "transferencia" | "tarjeta" | "mixto" | "fiado">("transferencia");
  const [finalPrice, setFinalPrice] = useState("");
  const [amountToCharge, setAmountToCharge] = useState("");
  const [amountReceived, setAmountReceived] = useState("");
  const [wantFiscal, setWantFiscal] = useState(false);
  /** Orden de taller: imprimir el comprobante de la orden al confirmar el cobro (best-effort). */
  const [printComprobante, setPrintComprobante] = useState(true);
  const [receptorTipo, setReceptorTipo] = useState<"cf" | "dni" | "cuit">("cf");
  const [receptorNro, setReceptorNro] = useState("");
  const [receptorNombre, setReceptorNombre] = useState("");
  const [receptorCond, setReceptorCond] = useState("6");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [useSignature, setUseSignature] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const sigRef = useRef<HTMLCanvasElement>(null);
  const sigDrawing = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);

  const total = fromPricing && Number(finalPrice) > 0 ? Number(finalPrice) : snapshotTotal;
  const balance = Math.max(0, total - depositPaid);
  // Vacío = cobrar el saldo exacto; si el comercio tipea, respeta lo tipeado.
  const amount = amountToCharge === "" ? balance : Number(amountToCharge);

  const vuelto = Number(amountReceived) - amount;

  useEffect(() => {
    if (!open) { setErr(null); return; }
    setFinalPrice(String(snapshotTotal));
    setAmountToCharge("");
    setAmountReceived("");
    setWantFiscal(false);
    setPrintComprobante(true);
    setReceptorTipo("cf");
    setReceptorNro("");
    setReceptorNombre("");
    setReceptorCond("6");
    setUseSignature(false);
    setSignatureName("");
    setSignatureData(null);
    if (firstInput.current) firstInput.current.focus();
  }, [open, snapshotTotal, depositPaid]);

  // Orden de taller: traer el detalle (repuestos + mano de obra) para mostrar
  // de qué está compuesto el total antes de cobrar (mismo dato que el detalle
  // de la orden: GET /api/vendor/bookings/[id]).
  const [orderParts, setOrderParts] = useState<{ name: string; qty: number; unit_price: number }[]>([]);
  const [orderLabor, setOrderLabor] = useState(0);
  useEffect(() => {
    if (!open || !isOrder || !booking?.id) {
      setOrderParts([]);
      setOrderLabor(0);
      return;
    }
    let cancelled = false;
    fetch(`/api/vendor/bookings/${booking.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const list = Array.isArray(d.parts) ? d.parts : [];
        setOrderParts(
          list.map((p: any) => ({
            name: String(p.name || "Repuesto"),
            qty: Number(p.qty) || 0,
            unit_price: Number(p.unit_price) || 0,
          }))
        );
        setOrderLabor(Number(d.booking?.labor_amount) || 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, isOrder, booking?.id]);

  function sigPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = sigRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function sigStart(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!useSignature) return;
    const canvas = sigRef.current;
    canvas?.setPointerCapture(e.pointerId);
    sigDrawing.current = true;
    const ctx = canvas?.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas!.width, canvas!.height);
      ctx.lineCap = "round";
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#101623";
      const p = sigPos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }
  function sigMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!sigDrawing.current) return;
    const ctx = sigRef.current?.getContext("2d");
    if (!ctx) return;
    const p = sigPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function sigEnd() {
    sigDrawing.current = false;
    const canvas = sigRef.current;
    if (canvas && useSignature) setSignatureData(canvas.toDataURL("image/jpeg", 0.7));
  }
  function sigClear() {
    const canvas = sigRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setSignatureData(null);
  }

  if (!open) return null;

  const fiscalAllowed = canFiscal && fiscalReady;
  const needsReceptor = wantFiscal && receptorTipo !== "cf";

  async function submit() {
    setErr(null);
    if (fromPricing && !(Number(finalPrice) > 0)) {
      setErr("Poné el precio final del servicio");
      return;
    }
    if (!(amount > 0)) {
      setErr("El monto a cobrar debe ser mayor a 0");
      return;
    }
    if (amount < balance) {
      setErr(`Monto insuficiente: el saldo es $${balance.toLocaleString("es-AR")}`);
      return;
    }
    const body: Record<string, unknown> = {
      payment_method: paymentMethod,
      amount_paid: amount,
    };
    if (fromPricing) body.final_price = Number(finalPrice);
    if (useSignature && signatureData) {
      body.signature_data = signatureData;
      body.signature_name = signatureName.trim() || undefined;
    }
    if (wantFiscal) {
      body.wantFiscal = true;
      body.receptorNombre = receptorNombre.trim() || undefined;
      if (receptorTipo === "dni") {
        body.receptorDocTipo = 96;
        body.receptorDocNro = receptorNro.replace(/\D/g, "");
        body.receptorCondIva = 5;
      } else if (receptorTipo === "cuit") {
        body.receptorDocTipo = 80;
        body.receptorDocNro = receptorNro.replace(/\D/g, "");
        body.receptorCondIva = Number(receptorCond) || 6;
      }
    }
    try {
      setSubmitting(true);
      const res = await fetch(`/api/vendor/bookings/${booking.id}/cobro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.hint ? `${data.error} 💡 ${data.hint}` : data.error || "No se pudo completar el cobro");
        return;
      }
      if (data.error) {
        setErr(data.error);
        return;
      }
      // Orden de taller: comprobante para el cliente (best-effort: si no hay
      // impresora conectada, el cobro igual quedó hecho).
      if (isOrder && printComprobante) {
        try {
          await fetch("/api/print", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "orden", bookingId: booking.id }),
          });
        } catch {
          /* sin conexión a impresora: se ignora */
        }
      }
      onSuccess();
    } catch {
      setErr("Sin conexión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[61] w-full max-w-md mx-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">
            💰 Cobrar {isOrder ? "orden" : "turno"} · {booking.customer_name || "Sin nombre"}
          </h2>
          <Button size="sm" variant="outline" className="h-7" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="space-y-3 text-sm">
          {fromPricing && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Precio final del servicio (se cobra "desde": definilo al atender)
              </Label>
              <Input
                value={finalPrice}
                onChange={(e) => setFinalPrice(e.target.value)}
                type="text"
                inputMode="decimal"
                placeholder={fmt(snapshotTotal)}
                className="h-9 text-xs"
                disabled={submitting}
              />
            </div>
          )}
          {isOrder && (orderParts.length > 0 || orderLabor > 0) && (
            <div className="rounded-lg border border-border bg-muted/40 p-2.5 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                🛠️ Detalle de la orden
              </p>
              {orderParts.map((p, i) => (
                <div key={i} className="flex justify-between text-xs gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {p.name}
                    {p.qty !== 1 ? ` × ${String(p.qty).replace(/\.00$/, "")}` : ""}
                  </span>
                  <span className="tabular-nums shrink-0">${fmt(p.unit_price * p.qty)}</span>
                </div>
              ))}
              {orderLabor > 0 && (
                <div className="flex justify-between text-xs">
                  <span>Mano de obra</span>
                  <span className="tabular-nums">${fmt(orderLabor)}</span>
                </div>
              )}
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted p-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Total del servicio</span>
              <span className="font-medium">${fmt(total)}</span>
            </div>
            {depositPaid > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Seña ya pagada</span>
                <span className="font-medium text-green-700">-${fmt(depositPaid)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-sm mt-1">
              <span>Saldo a cobrar</span>
              <span>${fmt(balance)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Medio de pago</Label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as any)}
              className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
              disabled={submitting}
            >
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="mixto">Mixto</option>
              <option value="fiado">Fiado (deuda, no se cobra ahora)</option>
            </select>
          </div>

          {paymentMethod === "efectivo" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Monto a cobrar</Label>

              <Input
                value={amountToCharge}
                onChange={(e) => setAmountToCharge(e.target.value)}
                type="text"
                inputMode="decimal"
                placeholder={fmt(balance)}
                className="h-9 text-xs"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">
                Mínimo $${fmt(balance)} (saldo tras descontar la seña).
              </p>
              <Label className="text-xs text-muted-foreground mt-1">Monto recibido (efectivo)</Label>
              <Input
                ref={firstInput}
                value={amountReceived}
                onChange={(e) => setAmountReceived(e.target.value)}
                type="text"
                inputMode="decimal"
                placeholder={fmt(balance)}
                className="h-9 text-xs"
                disabled={submitting}
              />
              {amountReceived && vuelto >= 0 && (
                <p className="text-xs text-muted-foreground">Vuelto: $${vuelto.toLocaleString("es-AR")}</p>
              )}
            </div>
          )}
          <div className="rounded-lg border border-border p-2.5 space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={useSignature}
                onChange={(e) => setUseSignature(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              ✍️ Pedir firma del cliente al entregar
            </label>
            {useSignature && (
              <div className="space-y-1.5">
                <div className="overflow-hidden rounded-lg border border-border bg-white">
                  <canvas
                    ref={sigRef}
                    width={560}
                    height={180}
                    className="h-28 w-full touch-none"
                    onPointerDown={sigStart}
                    onPointerMove={sigMove}
                    onPointerUp={sigEnd}
                    onPointerLeave={sigEnd}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder="Nombre del cliente (firma)"
                    className="h-7 text-xs flex-1"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={sigClear}>
                    Limpiar
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  El cliente firma en la pantalla. Queda guardada en la ficha de la orden.
                </p>
              </div>
            )}
          </div>

          {paymentMethod === "fiado" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Quedará como deuda pendiente; el turno no se marca como cobrado todavía.
            </p>
          )}

          {isOrder && (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={printComprobante}
                onChange={(e) => setPrintComprobante(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              🖨️ Imprimir comprobante de la orden al cobrar
            </label>
          )}

          {fiscalAllowed && (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={wantFiscal}
                onChange={(e) => setWantFiscal(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              🧾 Emitir Factura C (fiscal)
            </label>
          )}

          {canFiscal && !fiscalReady && (
            <p className="text-[10px] text-muted-foreground">
              Configurá facturación en Config → Fiscal para habilitarlo.
            </p>
          )}

          {wantFiscal && fiscalReady && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Receptor del comprobante</Label>
              <div className="flex items-center gap-2">
                <select
                  value={receptorTipo}
                  onChange={(e) => setReceptorTipo(e.target.value as "cf" | "dni" | "cuit")}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
                  disabled={submitting}
                >
                  <option value="cf">Consumidor final</option>
                  <option value="dni">DNI</option>
                  <option value="cuit">CUIT</option>
                </select>
                {needsReceptor && (
                  <input
                    value={receptorNro}
                    onChange={(e) => setReceptorNro(e.target.value)}
                    placeholder={receptorTipo === "cuit" ? "CUIT" : "DNI"}
                    inputMode="numeric"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
                    disabled={submitting}
                  />
                )}
                {receptorTipo === "cuit" && (
                  <div className="flex gap-1" style={{ width: "170px" }}>
                    <input
                      value={receptorNombre}
                      onChange={(e) => setReceptorNombre(e.target.value)}
                      placeholder="Razón social (opcional)"
                      className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-xs"
                      disabled={submitting}
                    />
                    <select
                      value={receptorCond}
                      onChange={(e) => setReceptorCond(e.target.value)}
                      className="h-9 rounded-lg border border-input bg-background px-2 text-xs"
                      disabled={submitting}
                    >
                      <option value="6">Monotributo</option>
                      <option value="1">Resp. Inscripto</option>
                      <option value="4">Exento</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" className="h-9 flex-1" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
           <Button size="sm" className="h-9 flex-1" disabled={submitting} onClick={submit}>
             <span className="flex items-center justify-center gap-2">
               <span>{submitting ? "Cobrando…" : paymentMethod === "fiado" ? "Registrar deuda" : "Cobrar"}</span>
             </span>
           </Button>
        </div>
      </div>
    </div>
  );
}
