"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";

type MethodTotals = { count: number; total: number };

type ClosingSummary = {
  since: string;
  ordersCount: number;
  grossTotal: number;
  discountsTotal: number;
  netTotal: number;
  byMethod: Record<string, MethodTotals>;
  cashTotal: number;
  avgTicket: number;
};

type Closing = {
  id: string;
  closed_at: string;
  since: string;
  orders_count: number;
  gross_total: number;
  discounts_total: number;
  net_total: number;
  by_method: Record<string, MethodTotals> | null;
  cash_declared: number | null;
  cash_difference: number | null;
  notes: string | null;
};

function money(n: number | null | undefined): string {
  return `$${Number(n || 0).toLocaleString("es-AR")}`;
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const METHOD_ORDER = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "mercadopago"];

function sortedMethods(byMethod: Record<string, MethodTotals>): [string, MethodTotals][] {
  return Object.entries(byMethod || {}).sort(
    (a, b) => (METHOD_ORDER.indexOf(a[0]) + 1 || 99) - (METHOD_ORDER.indexOf(b[0]) + 1 || 99)
  );
}

export function CajaManager() {
  const [summary, setSummary] = useState<ClosingSummary | null>(null);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cashDeclared, setCashDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setClosing] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const [live, hist] = await Promise.all([
        fetch("/api/vendor/cash-closing").then(async (r) => {
          const d = await r.json().catch(() => null);
          if (r.ok && d && d.summary) return d as { summary: ClosingSummary };
          throw new Error("sin datos");
        }),
        fetch("/api/vendor/cash-closing/history").then(async (r) => {
          const d = await r.json().catch(() => null);
          return r.ok && d ? (d as { closings: Closing[] }) : { closings: [] };
        }),
      ]);
      setSummary(live.summary);
      setClosings(hist.closings || []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const declared = cashDeclared === "" ? null : Number(cashDeclared);
  const difference =
    declared != null && summary ? Math.round((declared - summary.cashTotal) * 100) / 100 : null;

  async function handlePrint(closingId: string) {
    setPrintingId(closingId);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cash_close", closingId }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg(d.queued ? "Impresión encolada: la app del relay la recibe al reconectarse." : "Enviado a la impresora.");
      } else if (d?.code === "plan_limit") {
        setMsg("La impresión forma parte del plan Gestión integral.");
      } else {
        setMsg(d?.error || "No se pudo imprimir.");
      }
    } catch {
      setMsg("No se pudo imprimir. Revisá tu conexión.");
    } finally {
      setPrintingId(null);
    }
  }

  async function handleClose() {
    setClosing(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/cash-closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashDeclared: declared, notes }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg("Caja cerrada. Los próximos cobros arrancan desde ahora.");
        setCashDeclared("");
        setNotes("");
        setShowHistory(true);
        await load();
        if (d.closing?.id) await handlePrint(d.closing.id);
      } else {
        setMsg(d?.error || "No se pudo cerrar la caja.");
      }
    } catch {
      setMsg("No se pudo cerrar la caja. Revisá tu conexión.");
    } finally {
      setClosing(false);
    }
  }

  if (loading) return <p className="text-muted-foreground text-sm">Cargando caja...</p>;

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No se pudo cargar la caja. Revisá tu conexión.</p>
        <button onClick={load} className="text-sm font-medium text-primary underline">Reintentar</button>
      </div>
    );
  }

  const methods = sortedMethods(summary.byMethod);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold">Caja</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Cobros desde {fmtDateTime(summary.since)} (último cierre de caja)
        </p>
      </div>

      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${msg.includes("Caja cerrada") || msg.includes("impresora") || msg.includes("encolada") ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"}`}>
          {msg}
        </p>
      )}

      <div className="border border-border rounded-xl p-4 bg-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">Cierre actual</h3>
          <span className="text-xs text-muted-foreground">{summary.ordersCount} pedidos</span>
        </div>
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cobros desde el último cierre.</p>
        ) : (
          <div className="space-y-2">
            {methods.map(([m, d]) => (
              <div key={m} className="flex justify-between text-sm">
                <span className={m === "efectivo" ? "font-medium" : "text-muted-foreground"}>
                  {CASH_METHOD_LABELS[m] || m} <span className="text-xs text-muted-foreground">({d.count})</span>
                </span>
                <span className={`tabular-nums ${m === "efectivo" ? "font-medium" : ""}`}>{money(d.total)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-border mt-3 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-sm font-bold tabular-nums">{money(summary.netTotal)}</p>
            <p className="text-[10px] text-muted-foreground">Neto cobrado</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{money(summary.cashTotal)}</p>
            <p className="text-[10px] text-muted-foreground">Efectivo</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{money(summary.avgTicket)}</p>
            <p className="text-[10px] text-muted-foreground">Ticket prom.</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{summary.discountsTotal > 0 ? `-${money(summary.discountsTotal)}` : money(0)}</p>
            <p className="text-[10px] text-muted-foreground">Desc. efectivo</p>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-xl p-4 bg-card">
        <h3 className="font-medium text-sm mb-1">Arqueo (opcional)</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Contá el efectivo de la caja: el sistema espera {money(summary.cashTotal)}.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-muted-foreground">$</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={cashDeclared}
            onChange={(e) => setCashDeclared(e.target.value)}
            placeholder="Conteo físico"
            aria-label="Conteo físico de efectivo"
            className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        {difference != null && (
          <p className={`text-sm font-semibold mb-3 ${difference === 0 ? "text-green-600" : "text-red-600"}`}>
            {difference === 0
              ? "✓ Cuadra con el sistema"
              : `${difference > 0 ? "Sobra" : "Falta"} ${money(Math.abs(difference))}`}
          </p>
        )}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas del cierre (opcional)"
          aria-label="Notas del cierre"
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mb-3 resize-none"
        />
        <Button
          className="w-full"
          onClick={handleClose}
          disabled={saving || (declared != null && declared < 0)}
        >
          {saving ? "Cerrando..." : "🔒 Cerrar caja (Z)"}
        </Button>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Congela los cobros de este período y arranca uno nuevo desde ahora.
        </p>
      </div>

      <div className="border border-border rounded-xl bg-card overflow-hidden">
        <button
          onClick={() => setShowHistory((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium"
          aria-expanded={showHistory}
        >
          <span>Historial de cierres {closings.length > 0 && `(${closings.length})`}</span>
          <span className="text-muted-foreground">{showHistory ? "▲" : "▼"}</span>
        </button>
        {showHistory && (
          <div className="px-4 pb-4 space-y-2">
            {closings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no cerraste la caja.</p>
            ) : (
              closings.map((c) => {
                const diff = c.cash_difference != null ? Number(c.cash_difference) : null;
                return (
                  <div key={c.id} className="border border-border rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{fmtDateTime(c.closed_at)}</p>
                        <p className="text-xs text-muted-foreground">
                          Desde {fmtDateTime(c.since)} · {c.orders_count} pedidos
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold tabular-nums">{money(c.net_total)}</p>
                        {diff != null && diff !== 0 && (
                          <p className={`text-xs font-medium ${diff > 0 ? "text-green-600" : "text-red-600"}`}>
                            {diff > 0 ? "sobra" : "falta"} {money(Math.abs(diff))}
                          </p>
                        )}
                      </div>
                    </div>
                    {c.notes && (
                      <p className="text-xs text-muted-foreground mt-1.5 break-words">"{c.notes}"</p>
                    )}
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrint(c.id)}
                        disabled={printingId === c.id}
                      >
                        🖨️ {printingId === c.id ? "Enviando..." : "Imprimir"}
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
