"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { isFromPricing } from "@/lib/service-price";
import { useBankAccounts, BankAccountPickerModal } from "@/components/vendor/bank-account-picker";
import { bankAccountLabel, needsAccountPicker } from "@/lib/bank-accounts";
import { ProductImage } from "@/components/product-image";
import { shareReceiptImage, shareOutcomeMessage } from "@/lib/share-receipt";

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
  /** Imprimir el comprobante al confirmar el cobro (orden de taller o turno). */
  const [printComprobante, setPrintComprobante] = useState(true);
  /** Turno sin servicio asociado: partidas libres del detalle de la cuenta. */
  const [CuentaLine, setCuentaLine] = useState<{ description: string; qty: string; unitPrice: string }[]>([]);
  const [receptorTipo, setReceptorTipo] = useState<"cf" | "dni" | "cuit">("cf");
  const [receptorNro, setReceptorNro] = useState("");
  const [receptorNombre, setReceptorNombre] = useState("");
  const [receptorCond, setReceptorCond] = useState("6");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [receiptStatus, setReceiptStatus] = useState<string | null>(null);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [sendingReceipt, setSendingReceipt] = useState(false);
  const [receiptShare, setReceiptShare] = useState<{
    text: string;
    receiptText: string;
    filename: string;
    phone?: string | null;
    waUrl?: string | null;
    botLinked?: boolean;
  }>({
    text: "",
    receiptText: "",
    filename: "comprobante.png",
  });
  const firstInput = useRef<HTMLInputElement>(null);

  const { accounts: bankAccounts } = useBankAccounts();
  const [transferAccountId, setTransferAccountId] = useState<string | null>(null);
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);

  const cuentaItems = CuentaLine.map((l) => ({
    description: l.description.trim(),
    qty: Number(l.qty) || 1,
    unitPrice: Number(l.unitPrice) || 0,
  }));
  const cuentaTotal = cuentaItems.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  // Turno sin servicio ni precio asociado (y no es una orden): se cobra con
  // el detalle de la cuenta cargado a mano.
  const needCuenta = !isOrder && snapshotTotal <= 0;
  const total = fromPricing && Number(finalPrice) > 0
    ? Number(finalPrice)
    : snapshotTotal > 0
      ? snapshotTotal
      : cuentaTotal;
  const balance = Math.max(0, total - depositPaid);
  // Vacío = cobrar el saldo exacto; si el comercio tipea, respeta lo tipeado.
  const amount = amountToCharge === "" ? balance : Number(amountToCharge);

  const vuelto = Number(amountReceived) - amount;

  useEffect(() => {
    setErr(null);
    setDone(false);
    setReceiptStatus(null);
    setReceiptImageUrl(null);
    setFinalPrice(String(snapshotTotal));
    setAmountToCharge("");
    setAmountReceived("");
    setWantFiscal(false);
    setPrintComprobante(true);
    setCuentaLine([]);
    setReceptorTipo("cf");
    setReceptorNro("");
    setReceptorNombre("");
    setReceptorCond("6");
    setTransferAccountId(null);
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
  useEffect(() => {
    const active = (bankAccounts || []).filter((a: any) => a.active !== false);
    if (active.length === 1) setTransferAccountId(active[0].id);
  }, [bankAccounts]);

  // Al quedar registrado el cobro se genera el comprobante (imagen + textos)
  // para que el botón de enviar pueda abrir el chat del cliente SIN awaits
  // previos: si se abriera después, el navegador lo bloquea como popup.
  useEffect(() => {
    if (!done || !booking?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/vendor/bookings/${booking.id}/send-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send: false }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        if (data.url) setReceiptImageUrl(data.url);
        if (data.share) {
          setReceiptShare({
            text: String(data.share.text || ""),
            receiptText: String(data.share.receiptText || ""),
            filename: String(data.share.filename || "comprobante.png"),
            phone: data.share.phone || null,
            waUrl: data.share.waUrl || null,
            botLinked: !!data.share.botLinked,
          });
        }
      } catch {
        /* sin conexión: el botón avisa */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [done, booking?.id]);

  /**
   * Un solo botón para mandarle el comprobante al cliente:
   *  - bot vinculado → el server manda la imagen + el texto solo;
   *  - sin bot pero el móvil puede adjuntar archivos → imagen adjunta (Web Share);
   *  - sin bot y sin adjuntar (desktop/iOS) → chat del cliente con el
   *    comprobante ESCRITO + PNG descargado.
   */
  async function enviarComprobante() {
    setSendingReceipt(true);
    setReceiptStatus(null);
    try {
      if (receiptShare.botLinked) {
        const res = await fetch(`/api/vendor/bookings/${booking.id}/send-receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send: true }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          if (data.url) setReceiptImageUrl(data.url);
          if (data.share) {
            setReceiptShare((prev) => ({
              ...prev,
              text: String(data.share.text || prev.text),
              receiptText: String(data.share.receiptText || prev.receiptText),
              filename: String(data.share.filename || prev.filename),
              phone: data.share.phone || prev.phone,
              waUrl: data.share.waUrl || prev.waUrl,
              botLinked: !!data.share.botLinked,
            }));
          }
          setReceiptStatus(
            data.mode === "auto"
              ? "✅ Comprobante enviado por WhatsApp"
              : "⚠️ El bot no pudo enviarlo: usá el link de abajo para mandarlo vos."
          );
        } else {
          setReceiptStatus(data.error || "No se pudo enviar el comprobante");
        }
        return;
      }

      if (!receiptImageUrl) {
        setReceiptStatus("Generando el comprobante…");
        return;
      }
      const r = await shareReceiptImage({
        url: receiptImageUrl,
        filename: receiptShare.filename,
        title: "Comprobante de servicio",
        text: receiptShare.text,
        receiptText: receiptShare.receiptText,
        waUrl: receiptShare.waUrl,
        phone: receiptShare.phone || booking.customer_phone,
      });
      setReceiptStatus(shareOutcomeMessage(r));
    } catch {
      setReceiptStatus("Sin conexión");
    } finally {
      setSendingReceipt(false);
    }
  }

  // (moved below)

  if (done) {
    return (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center"
        role="dialog"
        aria-modal="true"
      >
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { onSuccess(); onClose(); }} />
        <div className="relative z-[61] w-full max-w-md mx-4 rounded-2xl border border-border bg-card p-5 shadow-xl space-y-3">
          <h2 className="text-sm font-semibold">✅ Cobro registrado</h2>
          <p className="text-xs text-muted-foreground">
            El turno quedó atendido y cobrado. ¿Enviar el comprobante por WhatsApp al cliente?
          </p>
          {receiptStatus && (
            <p className="text-xs text-muted-foreground">{receiptStatus}</p>
          )}
          {receiptImageUrl && (
            <div className="space-y-2">
              <ProductImage
                src={receiptImageUrl}
                name="Comprobante"
                alt="Comprobante"
                fit="contain"
                className="w-full rounded-lg border border-border"
              />
              <div className="flex flex-wrap gap-2">
                <a href={receiptImageUrl} download className="flex-1 min-w-[110px]">
                  <Button variant="outline" size="sm" className="w-full h-9">⬇️ Descargar imagen</Button>
                </a>
              </div>
              {receiptShare.waUrl && (
                <div className="space-y-1">
                  <a
                    href={receiptShare.waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    Abrir el chat de {String(booking.customer_name || "").trim().split(/\s+/)[0] || "la clienta"} en WhatsApp
                  </a>
                  {receiptShare.phone && (
                    <p className="text-[10px] text-muted-foreground">
                      WhatsApp: {receiptShare.phone}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-9 flex-1"
              disabled={sendingReceipt}
              onClick={enviarComprobante}
            >
              {sendingReceipt ? "Enviando…" : "📲 Enviar comprobante por WA"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 flex-1"
              onClick={() => { onSuccess(); onClose(); }}
            >
              Cerrar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!open) return null;

  const fiscalAllowed = canFiscal && fiscalReady;
  const needsReceptor = wantFiscal && receptorTipo !== "cf";

  async function submit() {
    setErr(null);
    if (needCuenta) {
      if (cuentaItems.length === 0) {
        setErr("Cargá al menos una línea del detalle del trabajo");
        return;
      }
      if (cuentaItems.some((it) => !it.description || it.qty <= 0 || it.unitPrice < 0)) {
        setErr("Revisá las líneas: descripción, cantidad mayor a 0 y precio");
        return;
      }
    }
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
    if (paymentMethod === "transferencia" && needsAccountPicker(bankAccounts) && !transferAccountId) {
      setAccountPickerOpen(true);
      return;
    }
    const body: Record<string, unknown> = {
      payment_method: paymentMethod,
      amount_paid: amount,
      bankAccountId: paymentMethod === "transferencia" ? transferAccountId : undefined,
    };
    if (fromPricing) body.final_price = Number(finalPrice);
    if (needCuenta && cuentaItems.length > 0) {
      body.cuenta_items = cuentaItems;
      if (!fromPricing) body.final_price = Math.round(cuentaTotal * 100) / 100;
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
      // Comprobante impreso para el cliente (best-effort): la orden de taller
      // imprime su comprobante; un turno cobrado imprime el recibo del
      // servicio. Si no hay impresora conectada, el cobro igual quedó hecho.
      if (printComprobante) {
        try {
          await fetch("/api/print", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: isOrder ? "orden" : "turno", bookingId: booking.id }),
          });
        } catch {
          /* sin conexión a impresora: se ignora */
        }
      }
      setDone(true);
      return;
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
          {needCuenta && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">🧾 Detalle del trabajo</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 text-[11px]"
                  disabled={submitting || CuentaLine.length >= 20}
                  onClick={() => setCuentaLine((prev) => [...prev, { description: "", qty: "1", unitPrice: "" }])}
                >
                  ＋ Sumar línea
                </Button>
              </div>
              {CuentaLine.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Este turno no tiene servicio asociado: cargá qué se le cobra (repuestos, mano de obra, lo que sea).
                </p>
              )}
              {CuentaLine.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={l.description}
                    onChange={(e) => setCuentaLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, description: e.target.value } : x)))}
                    placeholder="Descripción (ej: Plato 36D)"
                    maxLength={100}
                    className="h-8 flex-1 text-xs"
                    disabled={submitting}
                  />
                  <Input
                    value={l.qty}
                    onChange={(e) => setCuentaLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, qty: e.target.value } : x)))}
                    inputMode="decimal"
                    className="h-8 w-12 text-xs"
                    placeholder="Cant"
                    disabled={submitting}
                  />
                  <Input
                    value={l.unitPrice}
                    onChange={(e) => setCuentaLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, unitPrice: e.target.value } : x)))}
                    inputMode="decimal"
                    className="h-8 w-20 text-xs"
                    placeholder="$ unit"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setCuentaLine((prev) => prev.filter((_, xi) => xi !== i))}
                    className="text-muted-foreground hover:text-red-600 px-1"
                    title="Quitar línea"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-lg border border-border bg-muted p-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{needCuenta && cuentaItems.length > 0 ? "Total del detalle" : "Total del servicio"}</span>
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

          {paymentMethod === "transferencia" && needsAccountPicker(bankAccounts) && (
            <div className="flex items-center gap-2">
              {transferAccountId ? (
                <button
                  type="button"
                  onClick={() => setAccountPickerOpen(true)}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                  disabled={submitting}
                >
                  🏦 {bankAccountLabel((bankAccounts || []).find((a: any) => a.id === transferAccountId))} · cambiar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setAccountPickerOpen(true)}
                  className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-bold text-destructive hover:bg-destructive/20"
                  disabled={submitting}
                >
                  ⚠️ Elegir cuenta
                </button>
              )}
            </div>
          )}
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

          {isOrder ? (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={printComprobante}
                onChange={(e) => setPrintComprobante(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              🖨️ Imprimir comprobante de la orden al cobrar
            </label>
          ) : (
            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={printComprobante}
                onChange={(e) => setPrintComprobante(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              🖨️ Imprimir comprobante de servicio al cobrar
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

          {accountPickerOpen && (
            <BankAccountPickerModal
              accounts={bankAccounts}
              open={accountPickerOpen}
              onClose={() => setAccountPickerOpen(false)}
              onPick={(acc) => {
                setTransferAccountId(acc.id);
                setAccountPickerOpen(false);
              }}
              title="¿A qué cuenta va la transferencia?"
            />
          )}
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
