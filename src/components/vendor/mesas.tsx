"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ModifierPicker } from "@/components/offers/modifier-picker";
import { ProductPickCard } from "@/components/vendor/product-pick-card";
import { cashDiscountForItems, normalizeCashPct } from "@/lib/cash-discount";

type Table = {
  id: string;
  name: string;
  capacity: number;
  status: "libre" | "ocupada" | "reservada";
};

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
  /** Venta en packs (ej: 6). El precio es del paquete; la unidad se deriva. */
  pack_size?: number | null;
  modifiers?: ProductModifier[];
};

/** Tamaño del pack (1 = venta por unidad). */
function packOf(p: Product): number {
  return Number.isInteger(Number(p.pack_size)) && Number(p.pack_size) >= 2 ? Math.floor(Number(p.pack_size)) : 1;
}
/** Precio por unidad (con pack: price del paquete / pack_size). */
function unitPriceOf(p: Product): number {
  const base = Number(p.promo_price ?? p.price);
  const pk = packOf(p);
  return pk > 1 ? Math.round((base / pk) * 100) / 100 : base;
}

type Order = {
  id: string;
  table_id: string | null;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  status: string;
  created_at: string;
  paid_at?: string | null;
  pickup_number?: number | null;
};

const PAYMENT_OPTIONS = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transferencia" },
  { key: "tarjeta", label: "💳 Tarjeta" },
  { key: "mixto", label: "🪙 Mixto" },
];

export function Mesas() {
  const [tables, setTables] = useState<Table[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [newTable, setNewTable] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selected, setSelected] = useState<Table | null>(null);
  const [cart, setCart] = useState<{ product_id: string; name: string; price: number; qty: number; requires_prep: boolean; modifiers?: CartModifier[]; packSize?: number }[]>([]);
  const [modifiersMap, setModifiersMap] = useState<Record<string, ProductModifier[]>>({});
  const [pickerProduct, setPickerProduct] = useState<Product | null>(null);
  const [payment, setPayment] = useState("efectivo");
  // Mobile: la mesa se divide en 2 pantallas — "catalog" (sticky buscador +
  // pastillas + grilla) y "detail" (cuenta: consumiciones, precuenta, cobro).
  const [mobileView, setMobileView] = useState<"catalog" | "detail">("catalog");
  const [printingTicket, setPrintingTicket] = useState(false);
  // % descuento en efectivo del comercio (0 = sin descuento).
  const [cashPct, setCashPct] = useState(0);

  const load = useCallback(async () => {
    // Timeout: si la red queda colgada (p. ej. conexión móvil suspendida),
    // mostramos error con reintento en lugar de un spinner/"Cargando" eterno.
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 8000);
    try {
      const [tRes, oRes, pRes, mRes] = await Promise.all([
        fetch("/api/vendor/tables", { signal: ac.signal }),
        fetch("/api/vendor/orders", { signal: ac.signal }),
        fetch("/api/vendor/offers", { signal: ac.signal }),
        fetch("/api/vendor/me", { signal: ac.signal }),
      ]);
      const t = await tRes.json();
      const o = await oRes.json();
      const p = await pRes.json();
      const me = await mRes.json().catch(() => null);
      if (me?.vendor) setCashPct(normalizeCashPct(me.vendor.cash_discount_pct));
      if (t.tables) setTables(t.tables);
      if (o.orders) setOrders(o.orders);
      if (p.offers) {
        const modsMap = p.modifiersByProduct || {};
        setModifiersMap(modsMap);
        setProducts((p.offers || [])
          .filter((x: any) => x.available !== false)
          .map((x: any) => ({ ...x, modifiers: modsMap[x.id] || [] })));
      }
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Cuenta activa: solo consumiciones en curso (no liquidadas ni canceladas).
  // Al cerrar la mesa esas pasan a 'completed' (comprobante histórico) y dejan
  // de sumar al reabrir: reabrir siempre arranca en cero (modelo "cuenta abierta").
  const openOrders = useMemo(
    () =>
      selected
        ? orders.filter(
            (o) => o.table_id === selected.id && o.status !== "cancelled" && o.status !== "completed"
          )
        : [],
    [orders, selected]
  );
  const closedOrders = useMemo(
    () =>
      selected
        ? orders.filter((o) => o.table_id === selected.id && o.status === "completed")
        : [],
    [orders, selected]
  );
  const selectedTotal = openOrders.reduce((s, o) => s + Number(o.total), 0);

  // Descuento en efectivo de la mesa (misma fórmula que el servidor):
  // ítems de las consumiciones abiertas + lo pendiente de cargar.
  const productCashFlags = useMemo(
    () =>
      new Map(
        products.map((p) => [
          p.id,
          { hasPromo: p.promo_price != null, excluded: p.cash_discount_excluded === true },
        ])
      ),
    [products]
  );
  const mesaCash = useMemo(() => {
    const lines = [
      ...openOrders.flatMap((o) => o.items || []),
      ...cart,
    ];
    return cashDiscountForItems(
      lines.map((i: any) => {
        const info = i.product_id ? productCashFlags.get(i.product_id) : undefined;
        return { unitPrice: Number(i.price), qty: Number(i.qty), hasPromo: info?.hasPromo ?? false, excluded: info?.excluded ?? null };
      }),
      cashPct
    );
  }, [openOrders, cart, cashPct, productCashFlags]);

  // Chips de categoría agrupados por clave normalizada (trim+lowercase):
  // "Pizzas", "pizzas" o " Pizzas" forman un solo chip (igual que el micrositio).
  const normCat = (s: string | null | undefined) => (s || "").trim().toLowerCase();

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (!activeCat || normCat(p.category) === activeCat)
    );
  }, [products, query, activeCat]);

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

  async function addTable() {
    if (!newTable.trim()) return;
    const res = await fetch("/api/vendor/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTable.trim() }),
    });
    const data = await res.json();
    if (data.table) {
      setTables((prev) => [...prev, data.table]);
      setNewTable("");
      setMsg(`Mesa ${data.table.name} creada`);
    } else setMsg(data.error || "No se pudo crear la mesa");
    setTimeout(() => setMsg(""), 2500);
  }

  async function renameTable(t: Table) {
    const name = renameValue.trim();
    if (!name) return;
    const res = await fetch(`/api/vendor/tables/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (data.table) setTables((prev) => prev.map((x) => (x.id === t.id ? data.table : x)));
    setRenaming(null);
  }

  async function deleteTable(t: Table) {
    if (!confirm(`¿Eliminar la mesa ${t.name}?`)) return;
    const res = await fetch(`/api/vendor/tables/${t.id}`, { method: "DELETE" });
    const data = await res.json();
    if (data.ok) {
      setTables((prev) => prev.filter((x) => x.id !== t.id));
      setMsg(`Mesa ${t.name} eliminada`);
    } else setMsg(data.error || "No se pudo eliminar");
    setTimeout(() => setMsg(""), 2500);
  }

  function addProduct(p: Product) {
    const mods = modifiersMap[p.id] || [];
    if (mods.length > 0) {
      setPickerProduct(p);
      return;
    }
    addLine(p, unitPriceOf(p), []);
  }

  function addLine(p: Product, unitPrice: number, modifiers?: CartModifier[]) {
    const pk = packOf(p);
    setCart((prev) => {
      const key = `${p.id}|${(modifiers || []).map((m) => m.label).sort().join(",")}`;
      const found = prev.find((i) => `${i.product_id}|${(i.modifiers || []).map((m) => m.label).sort().join(",")}` === key);
      if (found) return prev.map((i) => (i === found ? { ...i, qty: i.qty + pk } : i));
      return [{ product_id: p.id, name: p.name, price: unitPrice, qty: pk, requires_prep: p.requires_prep !== false, modifiers, packSize: pk > 1 ? pk : undefined }, ...prev];
    });
  }

  function handleModConfirm(selected: CartModifier[], finalPrice: number) {
    if (pickerProduct) addLine(pickerProduct, finalPrice, selected);
    setPickerProduct(null);
  }

  // +/- en la lista del pedido de la mesa; llegar a 0 elimina la línea.
  // Con pack, el paso es de a N (i.packSize).
  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.product_id === productId ? { ...i, qty: i.qty + delta * (i.packSize || 1) } : i))
        .filter((i) => i.qty > 0)
    );
  }

  const cartLine = (i: (typeof cart)[number]) => (
    <div key={`${i.product_id}|${(i.modifiers || []).map((m) => m.label).join(",")}`} className="flex items-center gap-2 text-xs">
      <span className="flex-1 min-w-0 line-clamp-2 break-words">{i.name}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => changeQty(i.product_id, -1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">−</button>
        <span className="w-5 text-center tabular-nums">{i.qty}</span>
        <button type="button" onClick={() => changeQty(i.product_id, 1)} className="h-6 w-6 rounded-md bg-muted hover:bg-accent">+</button>
      </div>
      <span className="w-14 text-right tabular-nums">${(i.price * i.qty).toLocaleString("es-AR")}</span>
    </div>
  );

  async function addConsumicion() {
    if (!selected || cart.length === 0) return;
    const res = await fetch("/api/vendor/pos/consumicion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tableId: selected.id,
        items: cart.map((i) => ({ ...i, modifiers: (i.modifiers || []).map((m) => m.label) })),
        total: cart.reduce((s, i) => s + i.price * i.qty, 0),
        paymentMethod: payment,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      if (data.table?.status === "ocupada") {
        setTables((prev) => prev.map((x) => (x.id === selected.id ? { ...x, status: "ocupada" } : x)));
      }
      setCart([]);
      await load();
      setMsg(`Consumición cargada en ${selected.name}`);
    } else setMsg(data.error || "No se pudo cargar");
    setTimeout(() => setMsg(""), 2500);
  }

  async function closeTable() {
    if (!selected) return;
    const res = await fetch(`/api/vendor/tables/${selected.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: payment }),
    });
    const data = await res.json();
    if (data.ok) {
      setTables((prev) => prev.map((x) => (x.id === selected.id ? { ...x, status: "libre" } : x)));
      setSelected(null);
      setCart([]);
      await load();
      setMsg(
        `Mesa cobrada: $${Number(data.total).toLocaleString("es-AR")}` +
        (Number(data.cashDiscount) > 0
          ? ` (desc. efectivo −$${Number(data.cashDiscount).toLocaleString("es-AR")})`
          : "")
      );
    } else setMsg(data.error || "No se pudo cerrar la mesa");
    setTimeout(() => setMsg(""), 3000);
  }

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const mesaTotalNotDiscounted = selectedTotal + cartTotal;
  // Con efectivo se cobra el total con descuento; con otros medios, el pleno.
  const mesaPayTotal = Math.max(0, Math.round((mesaTotalNotDiscounted - (payment === "efectivo" ? mesaCash.cashDiscount : 0)) * 100) / 100);

  // Precuenta de la mesa (ticket térmico, sin cerrar): incluye lo ya cargado
  // más el carrito pendiente. No cierra ni cobra.
  async function printPrecuenta() {
    if (!selected || (openOrders.length === 0 && cart.length === 0)) return;
    const items = [
      ...openOrders.flatMap((o) => (o.items || [])),
      ...cart.map((i) => ({
        name: i.name,
        price: i.price,
        qty: i.qty,
        modifiers: (i.modifiers || []).map((m) => m.label),
      })),
    ];
    setPrintingTicket(true);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "precuenta",
          tableName: selected.name,
          items,
          total: selectedTotal + cartTotal,
          // Info de efectivo para el ticket: "Efectivo (-X%): $Y".
          cashPct: mesaCash.cashDiscount > 0 ? mesaCash.cashPct : 0,
          cashTotal: mesaCash.cashDiscount > 0 ? Math.max(0, mesaTotalNotDiscounted - mesaCash.cashDiscount) : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) setMsg("🖨️ Precuenta enviada a la impresora");
      else setMsg(data.reason || data.error || "No se pudo imprimir la precuenta");
    } catch {
      setMsg("Error de conexión al imprimir");
    } finally {
      setPrintingTicket(false);
      setTimeout(() => setMsg(""), 3000);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando mesas...</p>;

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No se pudieron cargar las mesas. Revisá tu conexión.</p>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); load(); }}>
          Reintentar
        </Button>
      </div>
    );
  }

  // Catálogo compartido: buscador + pastillas + grilla de productos.
  // Desktop: mismo patrón que Mostrador (grilla en flujo de página, scrollea la página).
  const catalogBlock = (gridClass: string) => (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar y agregar producto..."
          className="flex-1 h-10 px-3 text-sm rounded-xl border border-input bg-background"
        />
        {cartCount > 0 && (
          <Badge className="h-10 px-3 text-xs tabular-nums">🛒 {cartCount}</Badge>
        )}
      </div>
      {categories.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
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
              className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                activeCat === c.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${gridClass}`}>
        {filtered.map((p) => (
          <ProductPickCard
            key={p.id}
            product={p}
            hasModifiers={(modifiersMap[p.id] || []).length > 0}
            onAdd={() => addProduct(p)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-[11px] text-muted-foreground col-span-full text-center py-4">Sin productos</p>
        )}
      </div>
    </div>
  );

  const consumicionesBlock = (compact: boolean) => (
    <div className={`space-y-2 ${compact ? "" : ""}`}>
      {openOrders.map((o) => (
        <div key={o.id} className="rounded-xl bg-muted/50 p-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">
              {new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`}
            </span>
            <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
          </div>
          <div className="text-xs space-y-0.5">
            {(o.items || []).map((i, idx) => (
              <p key={idx} className="text-muted-foreground">
                {i.qty}x {i.name}
                {i.modifiers && i.modifiers.length > 0 && <span className="text-red-500"> ({i.modifiers.join(", ")})</span>}
              </p>
            ))}
          </div>
        </div>
      ))}
      {openOrders.length === 0 && selected?.status === "ocupada" && (
        <p className="text-xs text-muted-foreground">Mesa ocupada sin consumiciones registradas.</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newTable}
          onChange={(e) => setNewTable(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTable()}
          placeholder="Nombre de mesa nueva (ej: Mesa 1)..."
          className="flex-1 h-10 px-3 text-sm rounded-xl border border-input bg-background"
        />
        <Button onClick={addTable}>Agregar</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
        {tables.map((t) => {
          const occupied = t.status === "ocupada";
          const tableOrders = orders.filter((o) => o.table_id === t.id && o.status !== "cancelled" && o.status !== "completed");
          const subtotal = tableOrders.reduce((s, o) => s + Number(o.total), 0);
          return (
            <div
              key={t.id}
                onClick={() => { setSelected(t); setMobileView("catalog"); }}
              className={`rounded-2xl border-2 p-3 cursor-pointer transition-all active:scale-[0.98] ${
                occupied ? "border-primary bg-primary/5" : "border-border bg-card"
              } ${selected?.id === t.id ? "ring-2 ring-primary" : ""}`}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="font-display font-semibold text-sm truncate">{t.name}</p>
                <Badge className={`text-[9px] ${occupied ? "bg-status-new/15 text-status-new" : "bg-muted text-muted-foreground"}`}>
                  {occupied ? "Ocupada" : "Libre"}
                </Badge>
              </div>
              {occupied ? (
                <p className="text-xs font-semibold tabular-nums">${subtotal.toLocaleString("es-AR")}</p>
              ) : (
                <p className="text-[11px] text-muted-foreground">hasta {t.capacity} personas</p>
              )}
            </div>
          );
        })}
        {tables.length === 0 && (
          <p className="text-xs text-muted-foreground col-span-full text-center py-6">
            Todavía no creaste mesas. Agregá la primera arriba.
          </p>
        )}
      </div>

      {selected && (
        <>
          {/* ============ Desktop (sm+): catálogo en flujo + cuenta sticky (igual que Mostrador) ============ */}
          <div className="hidden sm:block">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-semibold">{selected.name}</h3>
              <div className="flex items-center gap-2">
                {renaming === selected.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && renameTable(selected)}
                    onBlur={() => setRenaming(null)}
                    className="h-8 px-2 text-xs rounded-lg border border-input bg-background w-32"
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setRenaming(selected.id); setRenameValue(selected.name); }}
                  >
                    Renombrar
                  </Button>
                )}
                {selected.status === "libre" && (
                  <Button variant="ghost" size="sm" onClick={() => deleteTable(selected)}>Eliminar</Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Cerrar</Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
              <div className="min-w-0">
                {catalogBlock("xl:grid-cols-4")}
              </div>
              {/* Cuenta sticky con scroll interno */}
              <div className="flex rounded-2xl border border-border bg-card p-4 flex-col gap-2 max-h-[70vh] lg:sticky lg:top-24 lg:h-[calc(100vh-12rem)] lg:max-h-none">
                <h3 className="font-display font-semibold text-sm mb-2 flex-shrink-0">Cuenta · {selected.name}</h3>
                <div className="flex-1 space-y-3 min-h-0 overflow-y-auto">
                  {consumicionesBlock(false)}
                  {cart.length > 0 && (
                    <div className="space-y-1">
                      {cart.map(cartLine)}
                    </div>
                  )}

                  {closedOrders.length > 0 && (
                    <div>
                      <CollapsibleSection icon="🧾" title={`Cuentas cerradas (${closedOrders.length})`} defaultOpen={false}>
                        <div className="space-y-1.5 opacity-70">
                          {closedOrders.map((o) => (
                            <div key={o.id} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">
                                {o.paid_at ? new Date(o.paid_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`}
                              </span>
                              <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
                            </div>
                          ))}
                        </div>
                      </CollapsibleSection>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 pt-2 flex-shrink-0">
                  {PAYMENT_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      onClick={() => setPayment(o.key)}
                      className={`rounded-full px-2 py-1 text-[10px] font-medium ${payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm flex-shrink-0">
                  <span>Total mesa</span>
                  <b className="tabular-nums">${mesaPayTotal.toLocaleString("es-AR")}</b>
                </div>
                {mesaCash.cashDiscount > 0 && (
                  <p className="text-[11px] leading-snug text-green-600 dark:text-green-400 flex-shrink-0">
                    {payment === "efectivo"
                      ? `💵 Desc. efectivo (${mesaCash.cashPct}%) aplicado: −$${mesaCash.cashDiscount.toLocaleString("es-AR")}`
                      : `💵 Pagando en efectivo: $${(mesaTotalNotDiscounted - mesaCash.cashDiscount).toLocaleString("es-AR")} (−${mesaCash.cashPct}%)`}
                  </p>
                )}
                <Button size="sm" className="flex-shrink-0" disabled={cart.length === 0} onClick={addConsumicion}>Agregar consumición</Button>
                <div className="grid grid-cols-2 gap-1.5 flex-shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={printingTicket || (openOrders.length === 0 && cart.length === 0)}
                    onClick={printPrecuenta}
                  >
                    {printingTicket ? "Imprimiendo..." : "🖨️ Precuenta"}
                  </Button>
                  <Button size="sm" variant="default" disabled={openOrders.length === 0 && cart.length === 0} onClick={closeTable}>
                    Cobrar y cerrar
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* ============ Mobile: modal pantalla completa, 2 vistas ============ */}
          <div className="sm:hidden fixed inset-0 z-[60] bg-background flex flex-col">
            <header className="flex items-center gap-2 border-b border-border px-3 py-3">
              <button
                onClick={() => (mobileView === "detail" ? setMobileView("catalog") : setSelected(null))}
                className="shrink-0 h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground"
                aria-label="Volver"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-semibold leading-tight truncate">
                  {mobileView === "catalog" ? selected.name : `Cuenta · ${selected.name}`}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {selected.status === "ocupada" ? "Ocupada" : "Libre"} · ${(selectedTotal + cartTotal).toLocaleString("es-AR")}
                </p>
              </div>
              {selected.status === "libre" && openOrders.length === 0 && cart.length === 0 && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => deleteTable(selected)}>Eliminar</Button>
              )}
            </header>

            {mobileView === "catalog" ? (
              <>
                {/* Vista A — catálogo: buscador + pastelas STICKY, grilla con espacio */}
                <div className="sticky top-0 z-10 bg-background border-b border-border/50 px-3 pt-2 pb-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Buscar y agregar producto..."
                      className="flex-1 h-10 px-3 text-sm rounded-xl border border-input bg-background"
                    />
                    {cartCount > 0 && (
                      <Badge className="h-10 px-3 text-xs tabular-nums">🛒 {cartCount}</Badge>
                    )}
                  </div>
                  {categories.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
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

                <div className="flex-1 overflow-y-auto px-3 pt-2pb-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {filtered.map((p) => (
                      <ProductPickCard
                        key={p.id}
                        product={p}
                        hasModifiers={(modifiersMap[p.id] || []).length > 0}
                        onAdd={() => addProduct(p)}
                      />
                    ))}
                    {filtered.length === 0 && (
                      <p className="text-[11px] text-muted-foreground col-span-full text-center py-6">Sin productos</p>
                    )}
                  </div>
                </div>

                {/* Barra a la vista "cuenta": resume lo que lleva la mesa */}
                <footer className="border-t border-border px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] bg-card">
                  <button
                    onClick={() => setMobileView("detail")}
                    className="w-full flex items-center justify-between rounded-xl bg-primary text-primary-foreground px-4 py-3 shadow-lg active:scale-[0.98] transition-transform"
                  >
                    <span className="text-sm font-semibold">
                      🧾 Detalle de la mesa
                      {cartCount > 0 && (
                        <span className="ml-1 text-[11px] opacity-90">
                          · {cartCount} sin cargar
                        </span>
                      )}
                    </span>
                    <span className="text-base font-bold tabular-nums">
                      ${(selectedTotal + cartTotal).toLocaleString("es-AR")}
                    </span>
                  </button>
                </footer>
              </>
            ) : (
              <>
                {/* Vista B — cuenta: consumiciones abiertas + pedido nuevo + cobro */}
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                      Consumiciones de la mesa ({openOrders.length})
                    </p>
                    {openOrders.length > 0 ? consumicionesBlock(false) : (
                      <p className="text-xs text-muted-foreground">Todavía no se cargaron consumiciones.</p>
                    )}
                  </div>

                  {cart.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                        Por cargar ({cartCount})
                      </p>
                      <div className="space-y-1.5">{cart.map(cartLine)}</div>
                    </div>
                  )}

                  {closedOrders.length > 0 && (
                    <CollapsibleSection icon="🧾" title={`Cuentas cerradas (${closedOrders.length})`} defaultOpen={false}>
                      <div className="space-y-1.5 opacity-70">
                        {closedOrders.map((o) => (
                          <div key={o.id} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground min-w-0 truncate">
                          {o.paid_at ? new Date(o.paid_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · {o.pickup_number != null ? `Nro. ${o.pickup_number}` : `#${o.id.slice(0, 6)}`}
                            </span>
                            <span className="font-semibold tabular-nums shrink-0">${Number(o.total).toLocaleString("es-AR")}</span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleSection>
                  )}
                </div>

                <footer className="border-t border-border px-3 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] space-y-2 bg-card">
                  <div className="flex flex-wrap gap-1">
                    {PAYMENT_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => setPayment(o.key)}
                        className={`rounded-full px-2 py-1 text-[10px] font-medium ${payment === o.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span>Total a cobrar</span>
                    <b className="tabular-nums">${mesaPayTotal.toLocaleString("es-AR")}</b>
                  </div>
                  {mesaCash.cashDiscount > 0 && (
                    <p className="text-[11px] leading-snug text-green-600 dark:text-green-400">
                      {payment === "efectivo"
                        ? `💵 Desc. efectivo (${mesaCash.cashPct}%) aplicado: −$${mesaCash.cashDiscount.toLocaleString("es-AR")}`
                        : `💵 Pagando en efectivo: $${(mesaTotalNotDiscounted - mesaCash.cashDiscount).toLocaleString("es-AR")} (−${mesaCash.cashPct}%)`}
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-1.5">
                    {cart.length > 0 && (
                      <Button size="sm" variant="secondary" onClick={addConsumicion}>
                        ➕ Cargar a la mesa ({cartCount} ítem{cartCount === 1 ? "" : "s"})
                      </Button>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={printingTicket || (openOrders.length === 0 && cart.length === 0)}
                        onClick={printPrecuenta}
                      >
                        {printingTicket ? "Imprimiendo..." : "🖨️ Precuenta"}
                      </Button>
                      <Button
                        size="sm"
                        disabled={openOrders.length === 0 && cart.length === 0}
                        onClick={closeTable}
                      >
                        Cobrado y cerrar
                      </Button>
                    </div>
                  </div>
                </footer>
              </>
            )}
          </div>
        </>
      )}

      {pickerProduct && (
        <ModifierPicker
          modifiers={modifiersMap[pickerProduct.id] || []}
          productName={pickerProduct.name}
            basePrice={unitPriceOf(pickerProduct)}
          onConfirm={handleModConfirm}
          onCancel={() => setPickerProduct(null)}
        />
      )}
    </div>
  );
}
