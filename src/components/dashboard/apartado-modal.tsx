"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QuantityInput } from "@/components/ui/quantity-input";
import type { ProductVariant } from "@/types/database";

type OfferLike = {
  id: string;
  name: string;
  price: number;
  promo_price?: number | null;
  category?: string | null;
  available: boolean;
  image_url?: string | null;
  stock?: number | null;
  stock_control?: boolean;
  has_variants?: boolean;
};

type CreatedApartado = {
  order: Record<string, unknown>;
  deposit_amount: number;
  remainder: number;
};

const PAY_METHODS = [
  { value: "efectivo", label: "💵 Efectivo" },
  { value: "transferencia", label: "🏦 Transferencia" },
  { value: "mercadopago", label: "📱 Mercado Pago" },
];

function defaultDueDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * Nuevo apartado / seña (moda). El comercio elige producto (+variante),
 * cliente, % de seña y vencimiento; el pedido reserva stock igual que uno
 * normal. Si la seña es por Mercado Pago, al crear se genera el link.
 */
export function ApartadoModal({
  open,
  onClose,
  offers,
  variants,
  defaultDepositPct,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  offers: OfferLike[];
  variants: ProductVariant[];
  defaultDepositPct: number | null;
  onChanged: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [depositPct, setDepositPct] = useState(defaultDepositPct != null ? String(defaultDepositPct) : "30");
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [method, setMethod] = useState("pickup");
  const [payMethod, setPayMethod] = useState("efectivo");
  const [paidNow, setPaidNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedApartado | null>(null);
  const [mpLink, setMpLink] = useState<string | null>(null);
  const [mpBusy, setMpBusy] = useState(false);

  const product = useMemo(() => offers.find((o) => o.id === productId) || null, [offers, productId]);
  const productVariants = useMemo(
    () => (product ? variants.filter((v) => v.product_id === product.id) : []),
    [variants, product]
  );
  const needsVariant = !!product?.has_variants && productVariants.length > 0;
  const chosenVariant = useMemo(
    () => productVariants.find((v) => v.id === variantId) || null,
    [productVariants, variantId]
  );
  const unitPrice = chosenVariant
    ? Number(chosenVariant.promo ?? chosenVariant.price)
    : product
      ? Number(product.promo_price ?? product.price)
      : 0;
  const maxStock = chosenVariant
    ? Number(chosenVariant.stock ?? 0)
    : product?.stock_control === false
      ? 99
      : Number(product?.stock ?? 0);
  const estTotal = unitPrice * qty;
  const estDeposito = Math.round(estTotal * (Number(depositPct) / 100) * 100) / 100;

  function resetAll() {
    setProductId("");
    setVariantId("");
    setQty(1);
    setCustomerName("");
    setCustomerPhone("");
    setDepositPct(defaultDepositPct != null ? String(defaultDepositPct) : "30");
    setDueDate(defaultDueDate());
    setMethod("pickup");
    setPayMethod("efectivo");
    setPaidNow(true);
    setSaving(false);
    setError("");
    setCreated(null);
    setMpLink(null);
  }

  function close() {
    resetAll();
    onClose();
  }

  async function handleSubmit() {
    setError("");
    if (!product) {
      setError("Elegí el producto a apartar.");
      return;
    }
    if (needsVariant && !chosenVariant) {
      setError("Elegí color y talle.");
      return;
    }
    if (qty > maxStock) {
      setError(`Solo quedan ${maxStock} disponibles.`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/vendor/apartados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: product.id,
          variant_id: chosenVariant?.id || null,
          qty,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          deposit_pct: Number(depositPct),
          deposit_due_at: dueDate,
          deposit_method: payMethod,
          deposit_paid: paidNow,
          method,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || "No se pudo crear el apartado.");
        return;
      }
      setCreated({ order: data.order, deposit_amount: data.deposit_amount, remainder: data.remainder });
      onChanged();
    } catch {
      setError("Error de red. Probá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleMpLink() {
    const orderId = created?.order?.id as string | undefined;
    if (!orderId) return;
    setMpBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/vendor/apartados/${orderId}/deposit-link`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || "No se pudo generar el link.");
        return;
      }
      setMpLink(data.initPoint as string);
    } catch {
      setError("Error de red. Probá de nuevo.");
    } finally {
      setMpBusy(false);
    }
  }

  if (!open) return null;
  const createdId = (created?.order?.id as string | undefined) || "";
  const customerWa = created && typeof created.order.customer_phone === "string" ? created.order.customer_phone : "";

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl bg-card sm:inset-0 sm:m-auto sm:max-w-md sm:h-fit sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-border">
          <p className="font-display font-semibold">🏷️ Nuevo apartado</p>
          <button
            type="button"
            onClick={close}
            className="h-8 w-8 shrink-0 rounded-full bg-muted flex items-center justify-center hover:bg-accent"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {!created ? (
            <>
              <div>
                <Label>Producto</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={productId}
                  onChange={(e) => { setProductId(e.target.value); setVariantId(""); setQty(1); }}
                >
                  <option value="">Elegí un producto…</option>
                  {offers.filter((o) => o.available).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — ${Number(o.promo_price ?? o.price).toLocaleString("es-AR")}
                    </option>
                  ))}
                </select>
              </div>

              {needsVariant && (
                <div>
                  <Label>Color y talle</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={variantId}
                    onChange={(e) => { setVariantId(e.target.value); setQty(1); }}
                  >
                    <option value="">Elegí combinación…</option>
                    {productVariants.map((v) => (
                      <option key={v.id} value={v.id} disabled={Number(v.stock ?? 0) <= 0}>
                        {v.color} / {v.talle} — ${Number(v.promo ?? v.price).toLocaleString("es-AR")} ({Number(v.stock ?? 0)} disp.)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cantidad</Label>
                  <QuantityInput value={qty} onChange={(v) => setQty(Math.max(1, Math.min(maxStock > 0 ? maxStock : 99, v)))} min={1} />
                  {maxStock > 0 && maxStock < 99 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">Máx. {maxStock} por stock</p>
                  )}
                </div>
                <div>
                  <Label>Total estimado</Label>
                  <p className="h-10 flex items-center font-display font-bold tabular-nums">
                    ${estTotal.toLocaleString("es-AR")}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Cliente</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre" />
                </div>
                <div>
                  <Label>WhatsApp</Label>
                  <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="11 5555 1234" inputMode="tel" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Seña (%)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={depositPct}
                    onChange={(e) => setDepositPct(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    ≈ ${estDeposito.toLocaleString("es-AR")} · saldo ${(estTotal - estDeposito).toLocaleString("es-AR")}
                  </p>
                </div>
                <div>
                  <Label>Vence</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block">La seña se cobra por</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PAY_METHODS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => { setPayMethod(m.value); if (m.value === "mercadopago") setPaidNow(false); }}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition ${
                        payMethod === m.value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={paidNow}
                  onChange={(e) => setPaidNow(e.target.checked)}
                  disabled={payMethod === "mercadopago"}
                  className="h-4 w-4 accent-primary"
                />
                <span className="text-muted-foreground">
                  {payMethod === "mercadopago" ? "Se genera el link para que pague online" : "Seña ya cobrada (en el local)"}
                </span>
              </label>

              {error && (
                <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ❌ {error}
                </p>
              )}

              <Button type="button" onClick={handleSubmit} disabled={saving} className="w-full">
                {saving ? "Guardando…" : "Crear apartado (reserva stock)"}
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm">
                <p className="font-semibold text-green-800">✅ Apartado creado (Nro. {(created.order.pickup_number as number | undefined) ?? ""})</p>
                <p className="text-green-700 mt-0.5 tabular-nums">
                  Seña ${Number(created.deposit_amount).toLocaleString("es-AR")} · Saldo ${Number(created.remainder).toLocaleString("es-AR")}
                </p>
              </div>

              {payMethod === "mercadopago" && !mpLink && (
                <Button type="button" variant="outline" onClick={handleMpLink} disabled={mpBusy} className="w-full">
                  {mpBusy ? "Generando…" : "🔗 Generar link de seña (Mercado Pago)"}
                </Button>
              )}
              {mpLink && (
                <div className="space-y-2">
                  <Label>Link para el cliente</Label>
                  <Input value={mpLink} readOnly onFocus={(e) => e.target.select()} className="h-9 text-xs" />
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => { void navigator.clipboard?.writeText(mpLink).catch(() => {}); }}
                    >
                      Copiar link
                    </Button>
                    {customerWa && (
                      <a
                        href={`https://wa.me/${customerWa}?text=${encodeURIComponent(`Hola, te paso el link para la seña de tu apartado: ${mpLink}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md bg-green-500 text-white text-sm font-medium py-2 text-center hover:bg-green-600"
                      >
                        Enviar por WA
                      </a>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  ❌ {error}
                </p>
              )}

              <Button type="button" onClick={close} className="w-full">
                Listo
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
