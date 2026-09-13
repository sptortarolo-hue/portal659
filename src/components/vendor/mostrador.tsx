"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { ProductPickCard } from "@/components/vendor/product-pick-card";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";

type ModifierOption = { label: string; price_mod: number };
type ProductModifier = {
  id: string;
  product_id: string;
  group_name: string;
  options: ModifierOption[];
  required: boolean;
  max_selections: number;
  position: number;
  created_at: string;
};
type CartModifier = { group: string; label: string; price_mod: number };

type Product = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  available: boolean;
  image_url?: string | null;
  category?: string | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean | null;
  modifiers?: ProductModifier[];
};

type LineItem = {
  product_id: string;
  name: string;
  price: number;
  qty: number;
  requires_prep: boolean;
  modifiers?: CartModifier[];
  /** Promo vigente + exclusión: reglas del descuento en efectivo. */
  hasPromo: boolean;
  cashExcluded: boolean;
};

type MostradorOrder = {
  id: string;
  total: number;
  payment_method: string;
  paid_at: string | null;
  status: string;
  created_at: string;
  customer_name?: string;
  pickup_number?: number | null;
  method?: string;
};

const PAYMENT_OPTIONS = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transferencia" },
  { key: "tarjeta", label: "💳 Tarjeta" },
  { key: "mixto", label: "🪙 Mixto" },
];

export function Mostrador() {
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [payment, setPayment] = useState("efectivo");
  const [customerName, setCustomerName] = useState("");
  const [method, setMethod] = useState<"pickup" | "delivery">("pickup");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [recent, setRecent] = useState<MostradorOrder[]>([]);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modifiersMap, setModifiersMap] = useState<Record<string, ProductModifier[]>>({});
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [convertOrderId, setConvertOrderId] = useState<string | null>(null);
  const [convertPhone, setConvertPhone] = useState("");
  const [convertAddress, setConvertAddress] = useState("");
  const [converting, setConverting] = useState(false);
  const [notes, setNotes] = useState("");
  // % descuento en efectivo del comercio (0 = sin descuento).
  const [cashPct, setCashPct] = useState(0);

  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);

  // Descuento en efectivo EN VIVO (misma fórmula que el servidor y el
  // micrositio): cambia al tocar medio de pago o al armar el pedido.
  const cashResult = useMemo(
    () =>
      cashDiscountForItems(
        items.map((i) => ({ unitPrice: i.price, qty: i.qty, hasPromo: i.hasPromo, excluded: i.cashExcluded })),
        cashPct
      ),
    [items, cashPct]
  );
  const activeCashDiscount = payment === "efectivo" ? cashResult.cashDiscount : 0;
  const payableTotal = Math.max(0, Math.round((total - activeCashDiscount) * 100) / 100);

  // Chips de categoría agrupados por clave normalizada (trim+lowercase):
  // "Pizzas", "pizzas" o " Pizzas" forman un solo chip (igual que el micrositio).
  const normCat = (s: string | null | undefined) => (s || "").trim().toLowerCase();

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => {
      if (p.category && p.category.trim()) {
        const key = normCat(p.category);
        if (!map.has(key)) map.set(key, p.category.trim());
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "es"))
      .map(([key, label]) => ({ key, label }));
  }, [products]);

  useEffect(() => {
    (async () => {
      try {
        const [offRes, ordRes, meRes] = await Promise.all([
          fetch("/api/vendor/offers"),
          fetch("/api/vendor/orders"),
          fetch("/api/vendor/me"),
        ]);
        const off = await offRes.json();
        const ord = await ordRes.json();
        const me = await meRes.json().catch(() => null);
        setCashPct(normalizeCashPct(me?.vendor?.cash_discount_pct));
        const today = new Date().toDateString();
        const modsMap = off.modifiersByProduct || {};
        setModifiersMap(modsMap);
        setProducts((off.offers || [])
          .filter((o: any) => o.available !== false)
          .map((o: any) => ({ ...o, modifiers: modsMap[o.id] || [] }))
        );
        setRecent(
          (ord.orders || [])
            .filter((o: any) => o.channel === "mostrador")
            .filter((o: any) => new Date(o.created_at).toDateString() === today)
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        );
      } catch { /* noop */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (!activeCat || normCat(p.category) === activeCat)
    );
  }, [products, query, activeCat]);

  function add(p: Product) {
    const mods = modifiersMap[p.id] || [];
    if (mods.length > 0) {
      setPickerProduct(p);
      return;
    }
    addLine(p, 1, Number(p.promo_price ?? p.price), []);
  }

  function addLine(p: Product, qty: number, unitPrice: number, modifiers?: CartModifier[]) {
    setItems((prev) => {
      const key = `${p.id}|${(modifiers || []).map((m) => m.label).sort().join(",")}`;
      const found = prev.find((i) => `${i.product_id}|${(i.modifiers || []).map((m) => m.label).sort().join(",")}` === key);
      if (found) return prev.map((i) => (i === found ? { ...i, qty: i.qty + qty } : i));
      return [...prev, {
        product_id: p.id, name: p.name, price: unitPrice, qty,
        requires_prep: p.requires_prep !== false, modifiers,
        hasPromo: p.promo_price != null, cashExcluded: p.cash_discount_excluded === true,
      }];
    });
  }

  function handleModConfirm(selected: CartModifier[], finalPrice: number) {
    if (pickerProduct) addLine(pickerProduct, 1, finalPrice, selected);
    setPickerProduct(null);
  }

  function changeQty(id: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.product_id === id ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  }

  async function charge(withReceipt: boolean) {
    if (items.length === 0) return;

    const isDelivery = method === "delivery";
    if (isDelivery && !customerPhone.trim()) {
      setMsg("El envío a domicilio requiere el teléfono del cliente");
      return;
    }

    // Solo entra a cocina si al menos un ítem requiere elaboración.
    const needsKitchen = items.some((i) => i.requires_prep !== false);

    setSaving(true);
    setMsg("");
    const res = await fetch("/api/vendor/pos/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((i) => ({ ...i, modifiers: (i.modifiers || []).map((m) => m.label) })),
        total,
        paymentMethod: payment,
        customerName: customerName || "Mostrador",
        method,
        customerPhone: isDelivery ? customerPhone : undefined,
        customerAddress: isDelivery ? customerAddress : undefined,
        notes: notes.trim() || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      setMsg(data.error || "No se pudo registrar el pedido");
      setSaving(false);
      return;
    }

    // Imprime comanda solo si requiere cocina; recién al terminar imprime el
    // comprobante de retiro (evita dos trabajos concurrentes a la impresora).
    const printRetiro = (): Promise<void> => {
      if (withReceipt && !isDelivery) {
        return fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderId, type: "retiro" }),
        }).then(() => {});
      }
      return Promise.resolve();
    };
    if (needsKitchen) {
      fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: data.orderId, type: "comanda" }),
      })
        .then(printRetiro)
        .catch(() => {});
    } else {
      printRetiro().catch(() => {});
    }

    // El servidor recalcula el descuento en efectivo (pos/order): el total
    // cobrado real viene en data.order.total.
    const netTotal = Number(data.order?.total ?? total);
    setMsg(
      isDelivery
        ? "Pedido a domicilio registrado"
        : `Cobrado $${netTotal.toLocaleString("es-AR")}${withReceipt ? " · comprobante de retiro" : ""}`
    );
    setItems([]);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerAddress("");
    setNotes("");
    setSheetOpen(false);
    setSaving(false);
    setRecent((prev) =>
      [{ id: data.orderId, total: Number(data.order?.total ?? total), payment_method: data.order?.payment_method ?? payment, paid_at: data.order?.paid_at ?? new Date().toISOString(), status: data.order?.status ?? "preparing", created_at: data.order?.created_at ?? new Date().toISOString(), pickup_number: data.order?.pickup_number ?? null, method: data.order?.method ?? method }, ...prev].slice(0, 20)
    );
  }

  // El cliente no quiere esperar más en el mostrador: convertir el pedido a domicilio.
  async function convertToDelivery(orderId: string) {
    if (!convertPhone.trim()) {
      setMsg("Ingresá el teléfono del cliente para el envío");
      return;
    }
    setConverting(true);
    setMsg("");
    try {
      const res = await fetch(`/api/vendor/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "delivery", customer_phone: convertPhone.trim(), customer_address: convertAddress.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMsg(data.error || "No se pudo convertir a domicilio");
      } else {
        setRecent((prev) =>
          prev.map((o) =>
            o.id === orderId ? { ...o, method: "delivery" } : o
          )
        );
        setConvertOrderId(null);
        setConvertPhone("");
        setConvertAddress("");
        setMsg("Pedido convertido a envío a domicilio");
      }
    } catch {
      setMsg("Error de conexión al convertir");
    } finally {
      setConverting(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando mostrador...</p>;

  const productsGrid = (
    <div className="space-y-2">
      {/* Buscador + categorías fijas arriba en mobile (debajo del header del dashboard) */}
      <div className="sticky top-24 z-30 -mx-4 px-4 py-2 bg-background sm:static sm:mx-0 sm:px-0 sm:py-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar producto..."
          className="w-full h-10 px-3 text-sm rounded-xl border border-input bg-background"
        />
        {categories.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 pt-2 scrollbar-hide">
            <button
              onClick={() => setActiveCat(null)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeCat === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              Todos
            </button>
            {categories.map((c) => (
              <button
                key={c.key}
                onClick={() => setActiveCat(activeCat === c.key ? null : c.key)}
                className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCat === c.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
        {filtered.map((p) => (
          <ProductPickCard
            key={p.id}
            product={p}
            hasModifiers={(modifiersMap[p.id] || []).length > 0}
            onAdd={() => add(p)}
          />
        ))}
        {filtered.length === 0 && <p className="text-xs text-muted-foreground col-span-full text-center py-6">Sin productos</p>}
      </div>
    </div>
  );

  const orderSummary = (
    <>
      <div className="flex-1 space-y-1.5 min-h-0 overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">Tocá productos para armar el pedido</p>}
        {items.map((i) => (
          <div key={`${i.product_id}|${(i.modifiers || []).map((m) => m.label).join(",")}`} className="flex items-center gap-2 text-sm">
            <span className="flex-1 min-w-0 line-clamp-2 break-words">
              {i.name}
              {(i.modifiers || []).length > 0 && (
                <span className="block text-[10px] text-muted-foreground truncate">
                  {(i.modifiers || []).map((m) => m.label).join(", ")}
                </span>
              )}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => changeQty(i.product_id, -1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">−</button>
              <span className="w-5 text-center tabular-nums">{i.qty}</span>
              <button onClick={() => changeQty(i.product_id, 1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">+</button>
            </div>
            <span className="w-16 text-right tabular-nums">${(i.price * i.qty).toLocaleString("es-AR")}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2 pt-3 border-t border-border">
        {/* Método de entrega */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => setMethod("pickup")}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "pickup" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🛍️ Para retirar
          </button>
          <button
            onClick={() => setMethod("delivery")}
            className={`rounded-lg py-1.5 text-xs font-medium border transition-colors ${
              method === "delivery" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            🛵 Envío a domicilio
          </button>
        </div>

        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Nombre del cliente (opcional)"
          className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
        />

        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="📝 Instrucciones especiales (ej: sin cebolla, extra picante, cortar al medio)"
          className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
        />

        {method === "delivery" && (
          <>
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="Teléfono del cliente *"
              className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
            />
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              placeholder="Dirección de entrega *"
              className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background"
            />
          </>
        )}

        <div className="flex flex-wrap gap-1.5">
          {PAYMENT_OPTIONS.map((o) => (
            <button
              key={o.key}
              onClick={() => setPayment(o.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="space-y-1 pt-1">
          {activeCashDiscount > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">${total.toLocaleString("es-AR")}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-medium text-green-600 dark:text-green-400">
                <span>💵 Desc. efectivo ({cashResult.cashPct}%)</span>
                <span className="tabular-nums">−${activeCashDiscount.toLocaleString("es-AR")}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total</span>
            <span className="font-display font-bold text-lg tabular-nums">${payableTotal.toLocaleString("es-AR")}</span>
          </div>
          {cashResult.cashPct > 0 && payment !== "efectivo" && cashResult.cashDiscount > 0 && (
            <p className="text-[11px] leading-snug text-green-700 dark:text-green-400">
              💵 Pagando en efectivo: ${(total - cashResult.cashDiscount).toLocaleString("es-AR")}
            </p>
          )}
        </div>

        <Button className="w-full" disabled={items.length === 0 || saving} onClick={() => charge(true)}>
          {saving ? "Cobrando..." : method === "pickup" ? "Cobrar + comprobante de retiro" : "Cobrar y despachar"}
        </Button>
        <Button className="w-full" variant="outline" disabled={items.length === 0 || saving} onClick={() => charge(false)}>
          {method === "pickup" ? "Cobrar sin comprobante" : "Cobrar sin imprimir comprobante"}
        </Button>
      </div>
    </>
  );

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div className="min-w-0">{productsGrid}</div>

        {/* Desktop sidebar: fija a altura de pantalla con scroll interno */}
        <div className="hidden sm:flex rounded-2xl border border-border bg-card p-4 flex-col max-h-[70vh] lg:sticky lg:top-24 lg:h-[calc(100vh-12rem)] lg:max-h-none">
          <h3 className="font-display font-semibold text-sm mb-2 flex-shrink-0">Pedido actual</h3>
          {orderSummary}
        </div>
      </div>

      {/* Mobile bottom bar */}
      {items.length > 0 && (
        <div className="sm:hidden fixed bottom-14 left-0 right-0 z-40 px-3 pb-3">
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full flex items-center justify-between rounded-xl bg-primary text-primary-foreground px-4 py-3 shadow-lg"
          >
            <span className="text-sm font-semibold">{items.length} {items.length === 1 ? "producto" : "productos"}</span>
            <span className="text-base font-bold">${payableTotal.toLocaleString("es-AR")}</span>
          </button>
        </div>
      )}

      {/* Mobile fullscreen modal del pedido */}
      {sheetOpen && (
        <div className="sm:hidden fixed inset-0 z-[60] bg-background flex flex-col">
          <header className="relative flex items-center border-b border-border px-3 py-3">
            {/* Volver/agregar más productos: mismo patrón que el modal de Mesas */}
            <button
              onClick={() => setSheetOpen(false)}
              className="shrink-0 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
              aria-label="Volver y agregar más productos"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 min-w-0 text-center">
              <h3 className="font-display font-semibold leading-tight">Pedido actual</h3>
              <p className="text-[11px] text-muted-foreground">{items.length} {items.length === 1 ? "producto" : "productos"} · ${total.toLocaleString("es-AR")}</p>
            </div>
            <button
              onClick={() => setItems([])}
              disabled={items.length === 0}
              className="shrink-0 h-8 px-2 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              Limpiar
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
            {orderSummary}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <h3 className="font-display font-semibold text-sm mb-3">Ventas de hoy en mostrador</h3>
          <div className="space-y-1.5">
            {recent.map((o) => {
              const canConvert =
                (o.method !== "delivery") &&
                o.status !== "completed" &&
                o.status !== "cancelled";
              return (
                <div key={o.id} className="space-y-2">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Badge variant="secondary" className="text-[9px]">{o.payment_method}</Badge>
                      {o.pickup_number != null && (
                        <Badge className="text-[9px] bg-status-new/15 text-status-new">Nro. {o.pickup_number}</Badge>
                      )}
                      {o.method === "delivery" && (
                        <Badge className="text-[9px] bg-blue-100 text-blue-700">🛵 A domicilio</Badge>
                      )}
                      <span className="text-muted-foreground truncate">{o.customer_name || "Mostrador"}</span>
                      <span className="text-muted-foreground/60 shrink-0">{new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canConvert && (
                        <button
                          type="button"
                          title="Convertir a envío a domicilio"
                          onClick={() => {
                            if (convertOrderId === o.id) { setConvertOrderId(null); return; }
                            setConvertOrderId(o.id); setConvertPhone(""); setConvertAddress("");
                          }}
                          className="h-6 w-6 rounded-md bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 flex items-center justify-center text-xs"
                        >
                          🛵
                        </button>
                      )}
                      <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
                    </div>
                  </div>
                  {convertOrderId === o.id && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-2 space-y-1.5">
                      <p className="text-[10px] font-semibold text-blue-800">Enviar este pedido a domicilio</p>
                      <input
                        type="tel"
                        value={convertPhone}
                        onChange={(e) => setConvertPhone(e.target.value)}
                        placeholder="Teléfono del cliente *"
                        className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-background"
                      />
                      <input
                        type="text"
                        value={convertAddress}
                        onChange={(e) => setConvertAddress(e.target.value)}
                        placeholder="Dirección de entrega (opcional)"
                        className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-background"
                      />
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 text-xs flex-1" disabled={converting} onClick={() => convertToDelivery(o.id)}>
                          {converting ? "..." : "Confirmar envío"}
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConvertOrderId(null)}>Cancelar</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pickerProduct && (
        <ModifierPicker
          modifiers={modifiersMap[pickerProduct.id] || []}
          productName={pickerProduct.name}
          basePrice={Number(pickerProduct.promo_price ?? pickerProduct.price)}
          onConfirm={handleModConfirm}
          onCancel={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
}