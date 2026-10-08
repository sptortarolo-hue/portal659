"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SOURCE_LABELS,
  type Expense,
  type ExpenseSource,
} from "@/lib/expenses";

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const s = String(v).slice(0, 10);
  return s.split("-").reverse().join("/");
}

const SOURCES: { value: string; label: string }[] = [
  { value: "", label: "Todos los orígenes" },
  { value: "manual", label: "Manual" },
  { value: "caja", label: "Caja" },
  { value: "compra", label: "Compra" },
];

/**
 * Libro de gastos: carga manual + auto-feed (retiros de caja categorizados
 * y compras a proveedor). Filtros + totales + salidas (A4/XLSX/CSV).
 */
export function ExpensesManager() {
  const weekAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(todayStr);
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ count: number; total: number; byCategory: Record<string, { count: number; total: number }>; expenses: Expense[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [msg, setMsg] = useState("");
  // Alta manual (modal)
  const [formOpen, setFormOpen] = useState(false);
  const [fCategory, setFCategory] = useState<string>("Varios");
  const [fAmount, setFAmount] = useState("");
  const [fDate, setFDate] = useState(todayStr);
  const [fSupplier, setFSupplier] = useState("");
  const [fNote, setFNote] = useState("");
  const [fPay, setFPay] = useState("efectivo");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (category) p.set("category", category);
      if (source) p.set("source", source);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/vendor/expenses?${p.toString()}`);
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.expenses === undefined) throw new Error(d?.error || "sin datos");
      setData(d);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [from, to, category, source, q]);

  useEffect(() => { load(); }, [load]);

  const query = (() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (category) p.set("category", category);
    if (source) p.set("source", source);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  })();

  async function handleSave() {
    const amount = Number(fAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg("Indicá un monto mayor a 0.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: fCategory,
          amount,
          spent_at: fDate || undefined,
          supplier: fSupplier.trim() || undefined,
          note: fNote.trim() || undefined,
          payment_method: fPay.trim() || undefined,
        }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg(`Gasto de ${money(amount)} registrado.`);
        setFormOpen(false);
        setFAmount("");
        setFSupplier("");
        setFNote("");
        await load();
      } else {
        setMsg(d?.error || "No se pudo guardar el gasto.");
      }
    } catch {
      setMsg("No se pudo guardar. Revisá tu conexión.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("¿Borrar este gasto manual?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/vendor/expenses/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg("Gasto borrado.");
        await load();
      } else {
        setMsg(d?.error || "No se pudo borrar.");
      }
    } catch {
      setMsg("No se pudo borrar. Revisá tu conexión.");
    } finally {
      setDeleting(null);
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">Cargando gastos...</p>;

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No se pudieron cargar los gastos. Revisá tu conexión.</p>
        <button onClick={load} className="text-sm font-medium text-primary underline">Reintentar</button>
      </div>
    );
  }

  const byCat = data ? Object.entries(data.byCategory).sort((a, b) => b[1].total - a[1].total) : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-semibold">Gastos</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manual + retiros de caja + compras a proveedor
          </p>
        </div>
        <Button size="sm" onClick={() => { setFDate(todayStr); setFormOpen(true); }}>
          + Gasto
        </Button>
      </div>

      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${msg.includes("registrado") || msg.includes("borrado") ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"}`}>
          {msg}
        </p>
      )}

      <div className="border border-border rounded-xl p-4 bg-card space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0" />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0" />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Categoría</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0">
              <option value="">Todas</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Origen</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0">
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 col-span-2 sm:col-span-1">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Proveedor, nota..."
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0"
            />
          </div>
        </div>
        <div className="rounded-xl bg-muted/50 px-4 py-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {data?.count ?? 0} movimientos
          </p>
          <p className="font-display text-2xl font-bold tabular-nums">{money(data?.total)}</p>
        </div>
        {byCat.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {byCat.map(([c, d]) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(category === c ? "" : c)}
                title="Filtrar por categoría"
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors ${category === c ? "border-primary text-primary bg-primary/5" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
              >
                {c} <span className="tabular-nums font-bold">{money(d.total)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <a href={`/vendor/gastos/reporte?${query}`} target="_blank" rel="noopener noreferrer">
            <Button type="button" variant="outline" size="sm" className="w-full">📄 A4</Button>
          </a>
          <a href={`/api/vendor/expenses?${query}&format=xlsx`}>
            <Button type="button" variant="outline" size="sm" className="w-full">XLSX</Button>
          </a>
          <a href={`/api/vendor/expenses?${query}&format=csv`}>
            <Button type="button" variant="outline" size="sm" className="w-full">CSV</Button>
          </a>
        </div>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        {(data?.expenses || []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sin gastos en el rango. Cargá el primero con + Gasto.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {(data?.expenses || []).map((e) => (
              <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {e.supplier || e.note || e.category}
                    {e.supplier && e.note ? <span className="text-muted-foreground font-normal"> · {e.note}</span> : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(e.spent_at)} · {e.category} · {EXPENSE_SOURCE_LABELS[e.source as ExpenseSource] || e.source}
                    {e.payment_method ? ` · ${e.payment_method}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-bold tabular-nums text-sm">{money(e.amount)}</span>
                  {e.source === "manual" ? (
                    <button
                      type="button"
                      onClick={() => handleDelete(e.id)}
                      disabled={deleting === e.id}
                      title="Borrar gasto"
                      className="text-red-600 hover:text-red-800 text-sm px-1"
                    >
                      🗑️
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground" title="Automático: se corrige desde su origen">🔗</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => !saving && setFormOpen(false)}>
          <div className="bg-card rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold">Nuevo gasto</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">Categoría</label>
                <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0">
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">Monto $</label>
                <input type="number" inputMode="decimal" min="0" step="0.01" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="0" className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">Fecha</label>
                <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0" />
              </div>
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground">Medio</label>
                <input type="text" value={fPay} onChange={(e) => setFPay(e.target.value)} placeholder="efectivo" maxLength={40} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0" />
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground">Proveedor (opcional)</label>
              <input type="text" value={fSupplier} onChange={(e) => setFSupplier(e.target.value)} placeholder="Quién cobró" maxLength={120} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0" />
            </div>
            <div className="min-w-0">
              <label className="text-xs text-muted-foreground">Nota (opcional)</label>
              <input type="text" value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder="Detalle" maxLength={280} className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm min-w-0" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
