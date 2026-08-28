"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildComandaWhatsApp } from "@/lib/whatsapp-message";
import { formatPhone, isValidPhone } from "@/lib/order-utils";
import { OrderSummaryModal } from "@/components/cart/order-summary-modal";

type VendorTransfer = {
  transfer_cbu: string | null;
  transfer_alias: string | null;
  transfer_qr_url: string | null;
  whatsapp: string | null;
  store_name: string;
  vertical?: string | null;
};

export default function CheckoutPage() {
  const router = useRouter();
  const { vendor, items, total, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<"delivery" | "pickup">("delivery");
  const [paymentMethod, setPaymentMethod] = useState<"whatsapp" | "efectivo" | "transferencia">("whatsapp");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [mpConfigured, setMpConfigured] = useState(false);
  const [vendorInfo, setVendorInfo] = useState<VendorTransfer | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<{ orderId: string; message: string; waNumber: string } | null>(null);

  useEffect(() => {
    fetch("/api/payments").then(r => r.json()).then(d => setMpConfigured(d.configured)).catch(() => {});
    fetch("/api/auth/me").then(r => r.json()).then(d => { if (d.user?.id) setUserId(d.user.id); }).catch(() => {});
    if (vendor?.id) {
      fetch(`/api/vendor/transfer-info?id=${vendor.id}`)
        .then(r => r.json())
        .then(d => setVendorInfo(d.vendor))
        .catch(() => {});
    }
  }, [vendor?.id]);

  if (!vendor || items.length === 0) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-5xl mb-4">🛒</div>
        <h1 className="font-display text-3xl font-semibold mb-4">
          Tu pedido está vacío
        </h1>
        <p className="text-muted-foreground mb-6">
          Agregá platos de un local para poder hacer el pedido.
        </p>
        <Button onClick={() => router.push("/")}>Ver ofertas</Button>
      </main>
    );
  }

  const v = vendor;
  const esModa = v.vertical === "moda";

  async function handleMercadoPago() {
    if (!name || !phone) return;
    if (!isValidPhone(phone)) {
      setError("Ingresá un número de WhatsApp válido (10 a 15 dígitos)");
      return;
    }
    setLoading(true);
    setError("");

    const cleanPhone = formatPhone(phone);

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId: v.id,
        items: items.map((i) => ({
          name: i.name,
          price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
          qty: i.qty,
        })),
        total,
        customerName: name,
        customerPhone: cleanPhone,
        customerAddress: method === "delivery" ? address : null,
        method,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }

    if (data.initPoint) {
      clear();
      window.location.href = data.initPoint;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;

    if (!isValidPhone(phone)) {
      setError("Ingresá un número de WhatsApp válido (10 a 15 dígitos)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const cleanPhone = formatPhone(phone);

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: v.id,
          customerName: name,
          customerPhone: cleanPhone,
          customerAddress: method === "delivery" ? address : null,
          method,
          paymentMethod,
          customerId: userId || null,
          items: items.map((i) => ({
            name: i.name,
            price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
            qty: i.qty,
            modifiers: (i.modifiers || []).map((m) => m.label),
          })),
          total,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || "Error al crear el pedido");
        setLoading(false);
        return;
      }

      const message = buildComandaWhatsApp({
        vendorName: v.storeName,
        items: items.map((i) => ({
          name: i.name,
          price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
          qty: i.qty,
          modifiers: (i.modifiers || []).map((m) => m.label),
        })),
        total,
        customerName: name,
        customerPhone: cleanPhone,
        method,
        address: method === "delivery" ? address : undefined,
        paymentMethod,
        notes: notes.trim() || undefined,
      });

      const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");
      setPendingOrder({ orderId: data.orderId || "", message, waNumber });
      setShowSummary(true);
      setLoading(false);
    } catch {
      setLoading(false);
      setError("Ocurrió un error al enviar el pedido. Probá de nuevo.");
    }
  }

  function confirmSend() {
    if (!pendingOrder) return;
    setLoading(true);
    window.open(
      `https://wa.me/${pendingOrder.waNumber}?text=${encodeURIComponent(pendingOrder.message)}`,
      "_blank"
    );
    clear();
    setShowSummary(false);
    setPendingOrder(null);
    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <div className="text-6xl mb-4 animate-bounce-in">✅</div>
        <h1 className="font-display text-3xl font-semibold mb-4">
          Pedido enviado
        </h1>
        <p className="text-muted-foreground mb-4">
          Se abrió WhatsApp con tu pedido para{" "}
          <span className="font-medium">{v.storeName}</span>.
        </p>
        <p className="text-sm text-muted-foreground/70 mb-6">
          Seguí el estado del pedido con tu número de WhatsApp en{" "}
          <button onClick={() => router.push("/mis-pedidos")} className="underline text-primary hover:text-primary/80">
            Mis pedidos
          </button>
        </p>
        <Button onClick={() => router.push("/")}>Seguir viendo ofertas</Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 max-w-md">
      <h1 className="font-display text-3xl font-semibold mb-2">
        Confirmar pedido
      </h1>
      <p className="text-muted-foreground text-sm mb-6">
        Con <span className="font-medium">{v.storeName}</span> · {items.length} items ·{" "}
        <span className="font-bold text-foreground">${total.toLocaleString("es-AR")}</span>
      </p>

      {/* Order summary */}
      <div className="border border-border rounded-2xl p-4 mb-6 bg-card space-y-3">
        {items.map((i, idx) => {
          const modTotal = (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0);
          const unitTotal = i.price + modTotal;
          return (
            <div key={`${i.offerId}-${idx}`} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 text-sm font-bold text-muted-foreground">
                {i.qty}x
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{i.name}</p>
                {i.modifiers && i.modifiers.length > 0 && (
                  <p className="text-xs text-muted-foreground/60 truncate">
                    {i.modifiers.map((m) => m.label).join(" · ")}
                  </p>
                )}
              </div>
              <span className="text-sm font-bold tabular-nums">
                ${Number(unitTotal * i.qty).toLocaleString("es-AR")}
              </span>
            </div>
          );
        })}
        <div className="border-t border-border pt-3 mt-2 flex justify-between font-bold text-lg">
          <span>Total</span>
          <span>${total.toLocaleString("es-AR")}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name & Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="name">Tu nombre</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre y apellido"
              required
            />
          </div>
          <div>
            <Label htmlFor="phone">Tu WhatsApp</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => { if (phone) setPhone(formatPhone(phone)); }}
              placeholder="2215550000"
              required
            />
          </div>
        </div>

        {/* Delivery method */}
        <div>
          <Label>¿Retirás o pedís delivery?</Label>
          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setMethod("delivery")}
              className={`flex-1 rounded-xl border-2 py-3 text-sm font-medium transition-all ${
                method === "delivery"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              🛵 A domicilio
            </button>
            <button
              type="button"
              onClick={() => setMethod("pickup")}
              className={`flex-1 rounded-xl border-2 py-3 text-sm font-medium transition-all ${
                method === "pickup"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              🏠 Retiro en el local
            </button>
          </div>
        </div>
        {method === "delivery" && (
          <div className="animate-fade-in-up">
            <Label htmlFor="address">Dirección</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Calle y número"
            />
          </div>
        )}

        {/* Notes */}
        <div className="animate-fade-in-up">
          <Label htmlFor="notes">Instrucciones especiales (opcional)</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={esModa ? "" : "Sin cebolla, extra picante, acceso por el costado..."}
            className="h-16 text-sm resize-none"
            maxLength={200}
          />
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">{notes.length}/200</p>
        </div>

        {/* Payment method */}
        <div>
          <Label>¿Cómo pagás?</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <button
              type="button"
              onClick={() => setPaymentMethod("whatsapp")}
              className={`rounded-xl border-2 py-3 text-sm font-medium transition-all ${
                paymentMethod === "whatsapp"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              📱 Coordinar
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("efectivo")}
              className={`rounded-xl border-2 py-3 text-sm font-medium transition-all ${
                paymentMethod === "efectivo"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              💵 Efectivo
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod("transferencia")}
              className={`rounded-xl border-2 py-3 text-sm font-medium transition-all ${
                paymentMethod === "transferencia"
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              🏦 Transferencia
            </button>
          </div>
        </div>

        {/* Transfer info */}
        {paymentMethod === "transferencia" && vendorInfo && (vendorInfo.transfer_cbu || vendorInfo.transfer_alias) && (
          <div className="rounded-2xl border border-fresh bg-fresh/30 p-5 space-y-3 animate-fade-in-up">
            <p className="font-medium text-fresh-foreground text-sm">Datos de transferencia:</p>
            {vendorInfo.transfer_cbu && (
              <div>
                <p className="text-xs text-muted-foreground">CBU</p>
                <p className="font-mono text-sm font-medium bg-card px-3 py-1.5 rounded-lg border border-border mt-0.5">{vendorInfo.transfer_cbu}</p>
              </div>
            )}
            {vendorInfo.transfer_alias && (
              <div>
                <p className="text-xs text-muted-foreground">Alias</p>
                <p className="font-mono text-sm font-medium bg-card px-3 py-1.5 rounded-lg border border-border mt-0.5">{vendorInfo.transfer_alias}</p>
              </div>
            )}
            {vendorInfo.transfer_qr_url && (
              <div className="flex justify-center pt-2">
                <img src={vendorInfo.transfer_qr_url} alt="QR Transferencia" className="h-40 rounded-xl border border-border" />
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Hero CTA */}
        <Button
          type="submit"
          className="w-full bg-whatsapp text-white hover:bg-whatsapp-dark h-12 text-base font-semibold rounded-xl active:scale-[0.98] transition-transform"
          disabled={loading}
        >
          {loading ? "Enviando pedido..." : "Confirmar pedido por WhatsApp"}
        </Button>

        {mpConfigured && (
          <button
            type="button"
            onClick={handleMercadoPago}
            disabled={loading}
            className="w-full rounded-xl border-2 border-blue-200 bg-blue-50 text-blue-700 py-3 text-sm font-medium hover:bg-blue-100 disabled:opacity-50 transition-all"
          >
            💳 Pagar con Mercado Pago
          </button>
        )}

        <p className="text-xs text-muted-foreground text-center px-4">
          {mpConfigured
            ? "Elegí WhatsApp para coordinar el pago directo, o pagá online con Mercado Pago."
            : "El pedido se envía al WhatsApp del local. Sin registro, sin pagar online: el local te pasa el total y coordinás el pago directo."}
        </p>
      </form>

      <OrderSummaryModal
        open={showSummary}
        onClose={() => { setShowSummary(false); }}
        onConfirm={confirmSend}
        vendorName={v.storeName}
        items={items.map((i) => ({
          name: i.name,
          price: i.price + (i.modifiers || []).reduce((s, m) => s + m.price_mod, 0),
          qty: i.qty,
          modifiers: (i.modifiers || []).map((m) => m.label),
        }))}
        total={total}
        method={method}
        address={method === "delivery" ? address : undefined}
        paymentMethod={paymentMethod}
        loading={loading}
      />
    </main>
  );
}
