"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerFormTimeline } from "@/components/dashboard/customer-form-timeline";

type Segment = "frecuente" | "nuevo" | "inactivo" | "ocasional";

type Customer = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  allergies?: string | null;
  skin_notes?: string | null;
  consent_at?: string | null;
  birthdate?: string | null;
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
  service_label?: string | null;
  staff_label?: string | null;
  products_used?: string | null;
  booking_date: string;
  booking_time: string;
  status: string;
  created_at: string;
};

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

/**
 * Cuenta corriente del cliente: saldo + registrar pago + historial.
 * Solo se muestra si hay movimientos (sin tabla/migración, no rompe nada).
 */
function FiadoBlock({ phone }: { phone: string }) {
  const [data, setData] = useState<{
    balance: number;
    charges: number;
    payments: number;
    moves: { kind: string; amount: number; note: string | null; created_at: string }[];
    pendingOrders: { id: string; total: number; created_at: string; pickup_number: number | null }[];
  } | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/vendor/account-moves?phone=${encodeURIComponent(phone)}`);
      const d = await r.json().catch(() => null);
      if (r.ok && d && typeof d.balance === "number") setData(d);
      else setData(null);
    } catch {
      setData(null);
    }
  }, [phone]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/vendor/me")
      .then((r) => r.json())
      .then((d) => {
        const id = (d?.vendor?.id || d?.id) as string | undefined;
        if (id) setVendorId(id);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;
  if (data.balance <= 0 && (data.moves || []).length === 0) return null;

  async function registerPay() {
    const v = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(v) || v <= 0) {
      setMsg("Ingresá un monto mayor a $0");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/vendor/account-moves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, amount: v }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(d?.error || "No se pudo registrar");
      } else {
        setMsg(
          d.coveredIds?.length > 0
            ? `Pago registrado ✓ (${d.coveredIds.length} pedido(s) saldado(s))`
            : "Pago registrado ✓"
        );
        setAmount("");
        await load();
      }
    } catch {
      setMsg("Sin conexión");
    }
    setSaving(false);
  }

  const waText = `Hola! Te escribo por tu cuenta: tu saldo es ${money(data.balance)}. Podés pasar a pagar o te paso link de Mercado Pago. Gracias!`;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
          📓 Cuenta corriente
        </p>
        <p className={`text-sm font-bold tabular-nums ${data.balance > 0 ? "text-amber-700 dark:text-amber-300" : "text-green-700"}`}>
          {data.balance > 0 ? `Debe ${money(data.balance)}` : "Al día ✓"}
        </p>
      </div>
      {data.balance > 0 && (
        <>
          <div className="flex gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Monto del pago $"
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
            />
            <Button size="sm" onClick={registerPay} disabled={saving}>
              {saving ? "…" : "Registrar pago"}
            </Button>
          </div>
          {vendorId && (
            <button
              type="button"
              disabled={linkBusy}
              onClick={async () => {
                const v = Math.round(Number(amount || data.balance) * 100) / 100;
                if (!Number.isFinite(v) || v <= 0) {
                  setMsg("Ingresá el monto para el link");
                  return;
                }
                setLinkBusy(true);
                setMsg("");
                try {
                  const r = await fetch("/api/payments", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ vendorId, debtPhone: phone, debtAmount: v }),
                  });
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok || !d?.initPoint) {
                    setMsg(d?.error || "No se pudo crear el link");
                  } else {
                    window.open(d.initPoint, "_blank", "noopener,noreferrer");
                    setMsg("Link de pago abierto: compartilo por WhatsApp al cliente");
                  }
                } catch {
                  setMsg("Sin conexión");
                }
                setLinkBusy(false);
              }}
              className="block w-full text-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium py-2 transition-colors disabled:opacity-50"
            >
              {linkBusy ? "Generando…" : "🔗 Link de pago online (Mercado Pago)"}
            </button>
          )}
          <a
            href={`https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(waText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 text-xs font-medium py-2 transition-colors"
          >
            💬 Cobrar por WhatsApp
          </a>
        </>
      )}
      {msg && <p className="text-xs font-medium text-muted-foreground">{msg}</p>}
      {(data.moves || []).length > 0 && (
        <div className="space-y-1 pt-1">
          {data.moves.slice(0, 6).map((m, i) => (
            <div key={i} className="flex justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {new Date(m.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}
                {" · "}
                {m.kind === "charge" ? "Venta fiada" : "Pago"}
                {m.note ? (m.note.startsWith("mp:") ? " · Pago online ✓" : ` · ${m.note}`) : ""}
              </span>
              <span className={`font-medium tabular-nums ${m.kind === "charge" ? "text-red-600" : "text-green-600"}`}>
                {m.kind === "charge" ? "+" : "−"}{money(m.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function waLink(phone: string): string {
  const d = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${d}`;
}

export function CustomersManager({ serviceMode = false, vendorId = null }: { serviceMode?: boolean; vendorId?: string | null } = {}) {
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
  // Ficha de estética (alergias/piel + consentimiento). Solo se muestra en serviceMode.
  const [editAllergies, setAllergies] = useState("");
  const [editSkinNotes, setSkinNotes] = useState("");
  const [editConsent, setConsent] = useState(false);
  const [editBirthdate, setBirthdate] = useState("");
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
    setAllergies(c.allergies || "");
    setSkinNotes(c.skin_notes || "");
    setConsent(!!c.consent_at);
    setBirthdate((c.birthdate || "").slice(0, 10));
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
        body: JSON.stringify({
          name: editName,
          address: editAddress,
          notes: editNotes,
          ...(serviceMode
            ? { allergies: editAllergies, skin_notes: editSkinNotes, consent: editConsent, birthdate: editBirthdate || null }
            : {}),
        }),
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
  const filtered = customers.filter((c) => {    if (segment !== "all" && c.segment !== segment) return false;
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

      {serviceMode && (() => {
        // Próximos cumpleaños (30 días): día+mes de birthdate, año corrido.
        const today = new Date();
        const upcoming = customers
          .filter((c) => /^\d{4}-\d{2}-\d{2}/.test(c.birthdate || ""))
          .map((c) => {
            const [, m, d] = (c.birthdate || "").split("-").map(Number);
            let next = new Date(today.getFullYear(), m - 1, d);
            if (next.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) {
              next = new Date(today.getFullYear() + 1, m - 1, d);
            }
            const days = Math.round((next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
            return { c, days, label: next.toLocaleDateString("es-AR", { day: "numeric", month: "short" }) };
          })
          .filter((x) => x.days <= 30)
          .sort((a, b) => a.days - b.days)
          .slice(0, 5);
        if (upcoming.length === 0) return null;
        return (
          <div className="rounded-xl border border-pink-200 bg-pink-50 px-3 py-2.5 space-y-1.5">
            <p className="text-xs font-bold text-pink-800">🎂 Cumpleaños cerca</p>
            {upcoming.map(({ c, days, label }) => (
              <div key={c.id} className="flex items-center gap-2 text-xs text-pink-900">
                <span className="flex-1 min-w-0 truncate">
                  <strong>{c.name || c.phone}</strong> · {days === 0 ? "¡hoy!" : days === 1 ? "mañana" : `en ${days} días (${label})`}
                </span>
                <a
                  href={`https://wa.me/${c.phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(`¡Feliz cumpleaños${c.name ? ` ${c.name.split(" ")[0]}` : ""}! 🎂 Te regalamos un mimo: contanos cuándo venís y te lo preparamos.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 rounded-md bg-green-500 text-white font-medium px-2 py-1 hover:bg-green-600"
                >
                  Saludar 📲
                </a>
              </div>
            ))}
          </div>
        );
      })()}

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
                  {serviceMode && (
                    <>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">⚠️ Alergias</label>
                          <textarea
                            value={editAllergies}
                            onChange={(e) => setAllergies(e.target.value)}
                            rows={2}
                            placeholder="Ej: alergia al látex, níquel..."
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">🧴 Piel / observaciones</label>
                          <textarea
                            value={editSkinNotes}
                            onChange={(e) => setSkinNotes(e.target.value)}
                            rows={2}
                            placeholder="Ej: piel sensible, rosácea, productos usados..."
                            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={editConsent}
                          onChange={(e) => setConsent(e.target.checked)}
                          className="h-4 w-4 rounded border-border"
                        />
                        <span>✅ Consentimiento informado registrado{(c.consent_at || editConsent) ? ` (${fmtDate(c.consent_at)})` : ""}</span>
                      </label>
                      <div>
                        <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">🎂 Cumpleaños</label>
                        <input
                          type="date"
                          value={editBirthdate}
                          onChange={(e) => setBirthdate(e.target.value)}
                          className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                        />
                      </div>
                    </>
                  )}
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

                  <FiadoBlock phone={c.phone} />

                  {serviceMode && (
                    <CustomerFormTimeline vendorId={vendorId} phone={c.phone} />
                  )}

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
                                      <span className="min-w-0">
                                        <span className="block truncate">
                                          {b.booking_date} {String(b.booking_time || "").slice(0, 5)}{(b.service_label || b.product_name) ? ` · ${b.service_label || b.product_name}` : ""}{b.staff_label ? ` (${b.staff_label})` : ""} — {b.status}
                                        </span>
                                        {b.products_used && (
                                          <span className="block truncate text-muted-foreground">🧴 {b.products_used}</span>
                                        )}
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
