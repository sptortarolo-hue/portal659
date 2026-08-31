"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Table = {
  id: string;
  name: string;
  capacity: number;
  status: "libre" | "ocupada" | "reservada";
};

type Product = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  available: boolean;
  image_url?: string | null;
  category?: string | null;
};

type Order = {
  id: string;
  table_id: string | null;
  items: { name: string; price: number; qty: number; modifiers?: string[] }[];
  total: number;
  status: string;
  created_at: string;
  paid_at?: string | null;
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
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [newTable, setNewTable] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selected, setSelected] = useState<Table | null>(null);
  const [cart, setCart] = useState<{ product_id: string; name: string; price: number; qty: number }[]>([]);
  const [payment, setPayment] = useState("efectivo");

  const load = useCallback(async () => {
    try {
      const [tRes, oRes, pRes] = await Promise.all([
        fetch("/api/vendor/tables"),
        fetch("/api/vendor/orders"),
        fetch("/api/vendor/offers"),
      ]);
      const t = await tRes.json();
      const o = await oRes.json();
      const p = await pRes.json();
      if (t.tables) setTables(t.tables);
      if (o.orders) setOrders(o.orders);
      if (p.offers) setProducts((p.offers || []).filter((x: any) => x.available !== false));
    } catch { /* noop */ } finally {
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

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return products.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (!activeCat || p.category === activeCat)
    );
  }, [products, query, activeCat]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
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
    setCart((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      if (found) return prev.map((i) => (i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i));
      return [{ product_id: p.id, name: p.name, price: p.promo_price != null ? Number(p.promo_price) : Number(p.price), qty: 1 }, ...prev];
    });
  }

  async function addConsumicion() {
    if (!selected || cart.length === 0) return;
    const res = await fetch("/api/vendor/pos/consumicion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tableId: selected.id,
        items: cart,
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
      setMsg(`Mesa cobrada: $${Number(data.total).toLocaleString("es-AR")}`);
    } else setMsg(data.error || "No se pudo cerrar la mesa");
    setTimeout(() => setMsg(""), 3000);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Cargando mesas...</p>;

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
              onClick={() => setSelected(t)}
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
        <div className="rounded-2xl border border-border bg-card p-4">
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

          <div className="space-y-2">
            {openOrders.map((o) => (
              <div key={o.id} className="rounded-xl bg-muted/50 p-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">
                    {new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · #{o.id.slice(0, 6)}
                  </span>
                  <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
                </div>
                <div className="text-xs space-y-0.5">
                  {o.items.map((i, idx) => (
                    <p key={idx} className="text-muted-foreground">
                      {i.qty}x {i.name}
                      {i.modifiers && i.modifiers.length > 0 && <span className="text-red-500"> ({i.modifiers.join(", ")})</span>}
                    </p>
                  ))}
                </div>
              </div>
            ))}
            {openOrders.length === 0 && selected.status === "ocupada" && (
              <p className="text-xs text-muted-foreground">Mesa ocupada sin consumiciones registradas.</p>
            )}
          </div>

          {closedOrders.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                Cuentas cerradas ({closedOrders.length})
              </p>
              <div className="space-y-1.5 opacity-70">
                {closedOrders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {o.paid_at ? new Date(o.paid_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })} · #{o.id.slice(0, 6)}
                    </span>
                    <span className="font-semibold tabular-nums">${Number(o.total).toLocaleString("es-AR")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-border grid sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar y agregar producto..."
                className="w-full h-9 px-3 text-xs rounded-lg border border-input bg-background mb-2"
              />
              {categories.length > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 mb-2 scrollbar-hide">
                  <button
                    onClick={() => setActiveCat(null)}
                    className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      activeCat === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    Todos
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => setActiveCat(activeCat === c ? null : c)}
                      className={`flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        activeCat === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 max-h-40 overflow-y-auto pr-1">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    className="text-left rounded-lg border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors active:scale-[0.97]"
                  >
                    <div className="aspect-square w-full bg-secondary">
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="font-display text-2xl font-bold text-primary/40">{p.name.charAt(0)}</span>
                        </div>
                      )}
                    </div>
                    <div className="p-1.5">
                      <p className="text-[10px] font-medium truncate">{p.name}</p>
                      <p className="text-[11px] font-semibold text-primary tabular-nums">
                        ${Number(p.promo_price ?? p.price).toLocaleString("es-AR")}
                      </p>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="text-[11px] text-muted-foreground col-span-full text-center py-4">Sin productos</p>
                )}
              </div>
              {cart.length > 0 && (
                <div className="mt-2 space-y-1">
                  {cart.map((i) => (
                    <div key={i.product_id} className="flex items-center justify-between text-xs">
                      <span>{i.qty}x {i.name}</span>
                      <span className="tabular-nums">${(i.price * i.qty).toLocaleString("es-AR")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col justify-between gap-2 min-w-40">
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
                <span>Total mesa</span>
                <b className="tabular-nums">${(selectedTotal + cart.reduce((s, i) => s + i.price * i.qty, 0)).toLocaleString("es-AR")}</b>
              </div>
              <Button size="sm" disabled={cart.length === 0} onClick={addConsumicion}>Agregar consumición</Button>
              <Button size="sm" variant="default" disabled={openOrders.length === 0 && cart.length === 0} onClick={closeTable}>
                Cobrar y cerrar mesa
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}