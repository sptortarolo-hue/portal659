"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type BookingCobroModalProps = {
  booking: any;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  canFiscal?: boolean;
  fiscalReady?: boolean;
};

function fmt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString("es-AR");
}

export function BookingCobroModal({
  booking,
  open,
  onClose,
  onSuccess,
  canFiscal = false,
  fiscalReady = false,
}: BookingCobroModalProps) {
  const total = Number(booking.service_price || 0);
  const depositPaid =
    booking.deposit_status === "paid" ? Number(booking.deposit_amount || 0) : 0;
  const balance = Math.max(0, total - depositPaid);

  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "transferencia" | "tarjeta" | "mixto" | "fiado">("efectivo");
  const [amountToCharge, setAmountToCharge] = useState(String(balance));
  const [amountReceived, setAmountReceived] = useState("");
  const [wantFiscal, setWantFiscal] = useState(false);
  const [receptorTipo, setReceptorTipo] = useState<"cf" | "dni" | "cuit">("cf");
  const [receptorNro, setReceptorNro] = useState("");
  const [receptorNombre, setReceptorNombre] = useState("");
  const [receptorCond, setReceptorCond] = useState("6");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  const vuelto = Number(amountReceived) - balance;

  useEffect(() => {
    if (!open) { setErr(null); return; }
    setAmountToCharge(String(balance));
    setAmountReceived("");
    setWantFiscal(false);
    setReceptorTipo("cf");
    setReceptorNro("");
    setReceptorNombre("");
    setReceptorCond("6");
    if (firstInput.current) firstInput.current.focus();
  }, [open, balance]);

  if (!open) return null;

  const fiscalAllowed = canFiscal && fiscalReady;
  const needsReceptor = wantFiscal && receptorTipo !== "cf";

  async function submit() {
    setErr(null);
    const parsed = Number(amountToCharge);
    if (!(parsed > 0)) {
      setErr("El monto a cobrar debe ser mayor a 0");
      return;
    }
    if (parsed < balance) {
      setErr(`Monto insuficiente: el saldo es $${balance.toLocaleString("es-AR")}`);
      return;
    }
    const body: Record<string, unknown> = {
      payment_method: paymentMethod,
      amount_paid: parsed,
    };
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
            💰 Cobrar turno · {booking.customer_name || "Sin nombre"}
          </h2>
          <Button size="sm" variant="outline" className="h-7" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <div className="space-y-3 text-sm">
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

          {paymentMethod === "fiado" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Quedará como deuda pendiente; el turno no se marca como cobrado todavía.
            </p>
          )}

          {canFiscal && (
            <div className="flex items-center gap-1.5">
              <Switch checked={wantFiscal} onCheckedChange={setWantFiscal} disabled={!fiscalReady} />
              <Label className="text-xs text-muted-foreground">
                Emitir comprobante fiscal (Factura C)
              </Label>
              {!fiscalReady && (
                <span className="text-[10px] text-muted-foreground">
                  Configurá facturación en Config → Fiscal para habilitarlo.
                </span>
              )}
            </div>
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
            {submitting ? "Cobrando…" : paymentMethod === "fiado" ? "Registrar deuda" : "Cobrar y atender"}
          </Button>
        </div>
      </div>
    </div>
  );
}
