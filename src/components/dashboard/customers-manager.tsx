"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Segment = "frecuente" | "nuevo" | "inactivo" | "ocasional";

type Customer = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  last_order_at: string | null;
  total_orders: number;
  total_spent: number;
  segment: Segment;
};

type Stats = {
  total: number;
  frecuentes: number;
  nuevos: number;
  inactivos: number;
  totalSpent: number;
};

type CustomerOrder = {
  id: string;
  items: { name: string; qty: number; price: number; pack_size?: number }[];
  total: number;
  status: string;
  method: string;
  created_at: string;
};

const SEGMENTS: { key: "all" | Segment; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "frecuente", label: "Frecuentes" },
  { key: "nuevo", label: "Nuevos" },
  { key: "inactivo", label: "Inactivos" },
];

const SEGMENT_STYLE: Record<Segment, string> = {
  frecuente: "bg-green-100 text-green-700",
  nuevo: "bg-blue-100 text-blue-700",
  inactivo: "bg-amber-100 text-amber-700",
  ocasional: "bg-muted text-muted-foreground",
};

const SEGMENT_LABEL: Record<Segment, string> = {
  frecuente: "Frecuente",
  nuevo: "Nuevo",
  inactivo: "Inactivo",
  ocasional: "Ocasional",
};

type CustomerQuote = {
  id: string;
  service_name: string | null;
  description: string;
  status: string;
  quoted_price: number | null;
  deposit_status: string | null;
  preferred_date: string | null;
  created_at: string;
};

type CustomerBooking = {
  id: string;
  product_name: string | null;
  booking_date: string;
  booking_time: string;
  status: string;
  created_at: string;
};

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function waLink(phone: string): string {
  const d = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${d}`;
}

export function CustomersManager({ serviceMode = false }: { serviceMode?: boolean } = {}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<"all" | Segment>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [quotes, setQuotes] = useState<CustomerQuote[]>([]);
  const [bookings, setBookings] = useState<CustomerBooking[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [editName, setName] = useState("");
  const [editAddress, setAddress] = useState("");
  const [editNotes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // Alta manual (modo servicio).
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vendor/customers");
      const d = await res.json().catch(() => null);
      if (res.ok && d && d.customers) {
        setCustomers(d.customers);
        setStats(d.stats ?? null);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openCustomer(c: Customer) {
    if (expandedId === c.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(c.id);
    setOrders([]);
    setQuotes([]);
    setBookings([]);
    setOrdersLoading(true);
    setMsg("");
    setName(c.name || "");
    setAddress(c.address || "");
    setNotes(c.notes || "");
    try {
      const res = await fetch(`/api/vendor/customers/${c.id}`);
      const d = await res.json().catch(() => null);
      if (res.ok && d) {
        setOrders(d.orders || []);
        setQuotes(d.quotes || []);
        setBookings(d.bookings || []);
      }
    } catch { /* noop */ }
    finally {
      setOrdersLoading(false);
    }
  }

  async function saveCustomer(c: Customer) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/vendor/customers/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, address: editAddress, notes: editNotes }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg("Datos del cliente guardados.");
        await load();
      } else {
        setMsg(d?.error || "No se pudieron guardar los datos.");
      }
    } catch {
      setMsg("No se pudieron guardar los datos. Revisá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  async function createCustomer() {
    if (!newName.trim() || !newPhone.trim()) {
      setMsg("Faltan nombre y teléfono.");
      return;
    }
    setCreating(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), phone: newPhone.trim(), address: newAddress.trim() || null }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.customer) {
        setNewName("");
        setNewPhone("");
        setNewAddress("");
        setShowNew(false);
        setMsg("Cliente agregado.");
        await load();
      } else {
        setMsg(d?.error || "No se pudo agregar.");
      }
    } catch {
      setMsg("No se pudo agregar. Revisá tu conexión.");
    } finally {
      setCreating(false);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = customers.filter((c) => {
    if (segment !== "all" && c.segment !== segment) return false;
    if (!q) return true;
    return (
      (c.name || "").toLowerCase().includes(q) ||
      c.phone.includes(q.replace(/[^\d]/g, ""))
    );
  });

  if (loading) return <p className="text-muted-foreground text-sm">Cargando clientes...</p>;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No se pudieron cargar los clientes. Revisá tu conexión.</p>
        <button onClick={load} className="text-sm font-medium text-primary underline">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Clientes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {serviceMode
              ? "Tu libro de clientes: se llena solo con cada presupuesto o turno, o agregalos a mano."
              : "Tu libro de clientes: se llena solo con los pedidos que traen teléfono."}
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {serviceMode && (
            <button
              onClick={() => setShowNew((v) => !v)}
              className="rounded-xl border border-border bg-background text-sm font-medium py-2 px-3 hover:bg-muted transition-colors"
            >
              ＋ Nuevo
            </button>
          )}
          <a
            href={`/api/vendor/customers?format=csv`}
            className="rounded-xl border border-border bg-background text-sm font-medium py-2 px-3 hover:bg-muted transition-colors flex-shrink-0"
          >
            ⬇️ CSV
          </a>
        </div>
      </div>

      {serviceMode && showNew && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="grid sm:grid-cols-3 gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nombre *"
              aria-label="Nombre del cliente"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Teléfono *"
              aria-label="Teléfono del cliente"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="Dirección (opcional)"
              aria-label="Dirección del cliente"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <Button size="sm" onClick={createCustomer} disabled={creating}>
            {creating ? "Guardando..." : "Agregar cliente"}
          </Button>
        </div>
      )}

      {msg && <p className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{msg}</p>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="border border-border rounded-xl p-3 bg-card text-center">
            <p className="text-lg sm:text-xl font-bold tabular-nums">{stats.total}</p>
            <p className="text-[10px] text-muted-foreground">Clientes</p>
          </div>
          <div className="border border-border rounded-xl p-3 bg-card text-center">
            <p className="text-lg sm:text-xl font-bold tabular-nums text-green-600">{stats.frecuentes}</p>
            <p className="text-[10px] text-muted-foreground">Frecuentes</p>
          </div>
          <div className="border border-border rounded-xl p-3 bg-card text-center">
            <p className="text-lg sm:text-xl font-bold tabular-nums text-amber-600">{stats.inactivos}</p>
            <p className="text-[10px] text-muted-foreground">+30 días sin pedir</p>
          </div>
          <div className="border border-border rounded-xl p-3 bg-card text-center">
            <p className="text-lg sm:text-xl font-bold tabular-nums">{money(stats.totalSpent)}</p>
            <p className="text-[10px] text-muted-foreground">Facturado a clientes</p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre o teléfono..."
          aria-label="Buscar cliente"
          className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
        />
        <div className="flex gap-1.5 flex-wrap">
          {SEGMENTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSegment(s.key)}
              className={`text-xs font-medium rounded-full px-3 py-1.5 transition-colors ${
                segment === s.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {customers.length === 0
              ? "Todavía no hay clientes. Se crean solos cuando llega un pedido con teléfono del cliente (app, delivery o MP)."
              : "Nadie coincide con la búsqueda."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => (
            <div key={c.id} className="border border-border rounded-xl bg-card overflow-hidden">
              <button
                onClick={() => openCustomer(c)}
                className="w-full text-left p-3 flex items-center gap-3"
                aria-expanded={expandedId === c.id}
              >
                <div className="h-9 w-9 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                  <span className="font-bold text-primary text-sm">{(c.name || "?").charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{c.name || "Sin nombre"}</span>
                    <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${SEGMENT_STYLE[c.segment]}`}>
                      {SEGMENT_LABEL[c.segment]}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.phone} · {serviceMode ? "Último trabajo" : "Última compra"} {fmtDate(c.last_order_at)}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold tabular-nums">{money(c.total_spent)}</p>
                  <p className="text-[10px] text-muted-foreground">{c.total_orders} {serviceMode ? (c.total_orders === 1 ? "trabajo" : "trabajos") : (c.total_orders === 1 ? "pedido" : "pedidos")}</p>
                </div>
              </button>

              {expandedId === c.id && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Nombre</label>
                      <input
                        value={editName}
                        onChange={(e) => setName(e.target.value)}
                        className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Dirección</label>
                      <input
                        value={editAddress}
                        onChange={(e) => setAddress(e.target.value)}
                        className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Notas</label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      placeholder="Ej: siempre pide sin cebolla, cliente del club..."
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => saveCustomer(c)} disabled={saving}>
                      {saving ? "Guardando..." : "Guardar"}
                    </Button>
                    <a
                      href={waLink(c.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-green-500 text-white text-sm font-medium py-1.5 px-3 hover:bg-green-600 transition-colors"
                    >
                      📲 WhatsApp
                    </a>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Últimos pedidos</p>
                    {ordersLoading ? (
                      <p className="text-xs text-muted-foreground">Cargando historial...</p>
                    ) : (
                      <>
                        {orders.length === 0 && quotes.length === 0 && bookings.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Sin movimientos registrados con este teléfono.</p>
                        ) : (
                          <>
                            {quotes.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Presupuestos</p>
                                <div className="space-y-1">
                                  {quotes.map((qt) => (
                                    <div key={qt.id} className="flex justify-between gap-2 text-xs py-1 border-b border-border last:border-0">
                                      <span className="min-w-0 truncate">
                                        {fmtDate(qt.created_at)} · {qt.service_name || "Presupuesto"} — {qt.status}
                                      </span>
                                      <span className="font-medium tabular-nums flex-shrink-0">{qt.quoted_price != null ? `$${Number(qt.quoted_price).toLocaleString("es-AR")}` : "—"}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {bookings.length > 0 && (
                              <div className="mb-2">
                                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Turnos</p>
                                <div className="space-y-1">
                                  {bookings.map((b) => (
                                    <div key={b.id} className="flex justify-between gap-2 text-xs py-1 border-b border-border last:border-0">
                                      <span className="min-w-0 truncate">
                                        {b.booking_date} {String(b.booking_time || "").slice(0, 5)}{b.product_name ? ` · ${b.product_name}` : ""} — {b.status}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {orders.length > 0 && (
                              <>
                                <p className="text-[11px] font-semibold text-muted-foreground mb-1">Pedidos</p>
                                <div className="space-y-1">
                                  {orders.map((o) => (
                                    <div key={o.id} className="flex justify-between gap-2 text-xs py-1 border-b border-border last:border-0">
                                      <span className="min-w-0 truncate">
                                        {fmtDate(o.created_at)} · {(o.items || []).map((i) => (i as any).unit === "kg" ? `${Number(i.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg ${i.name}` : `${i.qty}x ${i.name}`).join(", ")}
                                      </span>
                                      <span className="font-medium tabular-nums flex-shrink-0">${Number(o.total).toLocaleString("es-AR")}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
