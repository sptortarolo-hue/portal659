"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  senasTotal?: number;
  senasCount?: number;
};

type CashShift = {
  id: string;
  opened_at: string;
  opening_amount: number;
  opened_by: string | null;
  opened_by_name: string | null;
  status: "open" | "closed";
};

type CashMovement = {
  id: string;
  kind: "ingreso" | "retiro";
  amount: number;
  reason: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
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
  opened_at?: string | null;
  opening_amount?: number | null;
  opened_by_name?: string | null;
  movements?: { ingresos: number; retiros: number } | null;
  expected_cash?: number | null;
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

export function CajaManager({ closeRequest = 0 }: { closeRequest?: number }) {
  const [summary, setSummary] = useState<ClosingSummary | null>(null);
  const [shift, setShift] = useState<CashShift | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [disponible, setDisponible] = useState<number | null>(null);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cashDeclared, setCashDeclared] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setClosing] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  // Apertura
  const [openingAmount, setOpeningAmount] = useState("");
  const [opening, setOpening] = useState(false);
  // Movimiento manual (modal)
  const [movKind, setMovKind] = useState<"ingreso" | "retiro" | null>(null);
  const [movAmount, setMovAmount] = useState("");
  const [movReason, setMovReason] = useState("");
  const [movSaving, setMovSaving] = useState(false);
  // Pre-cierre (modal en 2 pasos: 1 Revisar, 2 Confirmar)
  const [showPreClose, setShowPreClose] = useState(false);
  const [preStep, setPreStep] = useState<1 | 2>(1);

  // Abrir el pre-cierre con números frescos (pueden haber entrado ventas).
  async function openPreClose() {
    setPreStep(1);
    setShowPreClose(true);
    await load();
  }

  // Pedido de cierre desde la pill del header: auto-abre el pre-cierre
  // (llega como prop porque el tab monta lazy).
  const closeReqSeen = useRef(0);
  useEffect(() => {
    if (closeRequest > 0 && closeRequest !== closeReqSeen.current) {
      closeReqSeen.current = closeRequest;
      openPreClose();
    }
  }, [closeRequest]);
  // Switch "exigir caja abierta para cobrar en Mostrador/Mesas".
  const [requireShift, setRequireShift] = useState(false);
  const [requireSaving, setRequireSaving] = useState(false);
  // Vista parcial X (snapshot sin cerrar)
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [printingSnapshot, setPrintingSnapshot] = useState(false);

  async function handlePrintSnapshot() {
    setPrintingSnapshot(true);
    try {
      const res = await fetch("/api/print", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "cash_snapshot" }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg(d.queued ? "Vista parcial encolada para imprimir." : "Vista parcial enviada a la impresora.");
      } else if (d?.code === "plan_limit") {
        setMsg("La impresión forma parte del plan Gestión integral.");
      } else {
        setMsg(d?.error || "No se pudo imprimir.");
      }
    } catch {
      setMsg("No se pudo imprimir. Revisá tu conexión.");
    } finally {
      setPrintingSnapshot(false);
    }
  }

  // Reporte consolidado por rango (estilo ZZ)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [repFrom, setRepFrom] = useState(weekAgo);
  const [repTo, setRepTo] = useState(todayStr);
  const [report, setReport] = useState<any>(null);
  const [repLoading, setRepLoading] = useState(false);

  async function loadReport() {
    setRepLoading(true);
    try {
      const q = new URLSearchParams();
      if (repFrom) q.set("from", repFrom);
      if (repTo) q.set("to", repTo);
      const res = await fetch(`/api/vendor/cash-closing/report?${q.toString()}`);
      const d = await res.json().catch(() => null);
      if (res.ok && d) setReport(d);
      else setMsg(d?.error || "No se pudo cargar el reporte.");
    } catch {
      setMsg("No se pudo cargar el reporte. Revisá tu conexión.");
    } finally {
      setRepLoading(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const [live, hist] = await Promise.all([
        fetch("/api/vendor/cash-closing").then(async (r) => {
          const d = await r.json().catch(() => null);
          if (r.ok && d && d.summary) return d as {
            summary: ClosingSummary;
            shift: CashShift | null;
            movements: CashMovement[];
            disponible: number | null;
            requireOpenShift?: boolean;
          };
          throw new Error("sin datos");
        }),
        fetch("/api/vendor/cash-closing/history").then(async (r) => {
          const d = await r.json().catch(() => null);
          return r.ok && d ? (d as { closings: Closing[] }) : { closings: [] };
        }),
      ]);
      setSummary(live.summary);
      setShift(live.shift || null);
      setMovements(live.movements || []);
      setDisponible(live.disponible);
      setRequireShift(live.requireOpenShift === true);
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
  // En el pre-cierre con turno, la diferencia es contra el esperado
  // (apertura + ventas + movimientos); sin turno, contra el efectivo.
  const expectedBase = shift && disponible != null ? disponible : summary?.cashTotal ?? 0;
  const difference =
    declared != null && summary ? Math.round((declared - expectedBase) * 100) / 100 : null;

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

  async function handleOpen() {
    const amount = Number(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMsg("Indicá el monto inicial en efectivo (0 o más).");
      return;
    }
    setOpening(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/cash-closing/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opening_amount: amount }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg(`Caja abierta con ${money(amount)} de fondo inicial.`);
        setOpeningAmount("");
        await load();
      } else {
        setMsg(d?.error || "No se pudo abrir la caja.");
      }
    } catch {
      setMsg("No se pudo abrir la caja. Revisá tu conexión.");
    } finally {
      setOpening(false);
    }
  }

  // Switch "exigir caja abierta": persiste en vendors.require_open_shift.
  // Se lee el valor devuelto por el servidor (si falta la migración, el
  // guardado la saltea y el switch queda apagado).
  async function handleRequireToggle(next: boolean) {
    setRequireSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require_open_shift: next }),
      });
      const d = await res.json().catch(() => null);
      const saved = d?.vendor?.require_open_shift === true;
      setRequireShift(saved);
      setMsg(
        saved
          ? "Con caja cerrada ya no se puede cobrar en Mostrador ni Mesas."
          : next
            ? "No se pudo activar (¿falta la migración de turnos en la base?)."
            : "Cobro liberado: ya no se exige caja abierta."
      );
    } catch {
      setMsg("No se pudo guardar. Revisá tu conexión.");
    } finally {
      setRequireSaving(false);
    }
  }

  // Fondo al cierre → próxima apertura: prellena el monto inicial con lo
  // último contado (editable; no pisa lo que ya estés escribiendo).
  useEffect(() => {
    if (shift || openingAmount !== "" || closings.length === 0) return;
    const last = closings[0];
    const v = last.cash_declared ?? last.expected_cash;
    if (v != null && Number(v) >= 0) setOpeningAmount(String(v));
  }, [shift, openingAmount, closings]);

  async function handleMovement() {    if (!movKind) return;
    const amount = Number(movAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg("Indicá un monto mayor a 0.");
      return;
    }
    if (!movReason.trim()) {
      setMsg("Indicá el motivo del movimiento.");
      return;
    }
    setMovSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/cash-closing/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: movKind, amount, reason: movReason.trim() }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) {
        setMsg(
          movKind === "ingreso"
            ? `Ingreso de ${money(amount)} registrado.`
            : `Retiro de ${money(amount)} registrado.`
        );
        setMovKind(null);
        setMovAmount("");
        setMovReason("");
        await load();
      } else {
        setMsg(d?.error || "No se pudo registrar el movimiento.");
      }
    } catch {
      setMsg("No se pudo registrar el movimiento. Revisá tu conexión.");
    } finally {
      setMovSaving(false);
    }
  }

  async function handleClose() {
    // El conteo físico es obligatorio para cerrar (paso 1 del pre-cierre
    // y arqueo legacy lo exigen en UI; el servidor también lo valida).
    if (declared == null || !(declared >= 0)) {
      setMsg("Contá el efectivo del cajón antes de cerrar la caja.");
      return;
    }
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
        // El contado de este cierre prellena la próxima apertura.
        if (cashDeclared !== "") setOpeningAmount(cashDeclared);
        setCashDeclared("");
        setNotes("");
        setShowPreClose(false);
        setPreStep(1);
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
  const ingresosTotal = movements.filter((m) => m.kind === "ingreso").reduce((s, m) => s + m.amount, 0);
  const retirosTotal = movements.filter((m) => m.kind === "retiro").reduce((s, m) => s + m.amount, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold">Caja</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {shift
            ? `Turno abierto desde ${fmtDateTime(shift.opened_at)}`
            : `Cobros desde ${fmtDateTime(summary.since)} (último cierre de caja)`}
        </p>
      </div>

      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 ${msg.includes("Caja cerrada") || msg.includes("abierta") || msg.includes("registrado") || msg.includes("impresora") || msg.includes("encolada") ? "text-green-600 bg-green-50" : "text-red-600 bg-red-50"}`}>
          {msg}
        </p>
      )}

      {shift ? (
        <div className="border border-primary/30 rounded-xl p-4 bg-card space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-sm">Turno abierto</h3>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" /> Abierta
            </span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div className="rounded-lg bg-muted/50 px-3 py-2 min-w-0">
              <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">Abierta por</dt>
              <dd className="font-medium truncate">{shift.opened_by_name || "—"}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2 min-w-0">
              <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">Apertura</dt>
              <dd className="font-medium tabular-nums">{fmtDateTime(shift.opened_at)}</dd>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2 min-w-0">
              <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">Monto inicial</dt>
              <dd className="font-medium tabular-nums">{money(shift.opening_amount)}</dd>
            </div>
          </dl>
          <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 text-center">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Efectivo disponible</p>
            <p className="font-display text-3xl font-bold tabular-nums">{money(disponible)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={() => { setMovKind("ingreso"); setMovAmount(""); setMovReason(""); }}>
              + Ingresar
            </Button>
            <Button type="button" variant="outline" onClick={() => { setMovKind("retiro"); setMovAmount(""); setMovReason(""); }}>
              − Retirar
            </Button>
            <Button type="button" onClick={openPreClose}>
              🔒 Cerrar caja
            </Button>
          </div>
        </div>
      ) : (
        <div className="border border-border rounded-xl p-4 bg-card space-y-3">
          <div>
            <h3 className="font-medium text-sm">Abrir caja</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Registrá el fondo inicial en efectivo: las ventas y movimientos del turno se cuentan desde la apertura.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={openingAmount}
              onChange={(e) => setOpeningAmount(e.target.value)}
              placeholder="Monto inicial en efectivo"
              aria-label="Monto inicial en efectivo"
              className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="button" onClick={handleOpen} disabled={opening}>
              {opening ? "Abriendo..." : "Abrir caja"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Opcional: sin turno abierto podés seguir cerrando la caja como hasta ahora (período desde el último cierre).
          </p>
        </div>
      )}

      <div className="border border-border rounded-xl p-4 bg-card flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-sm">Exigir caja abierta para cobrar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Prendido: el Mostrador y el cierre de mesa rechazan cobrar sin turno abierto.
          </p>
        </div>
        <Switch
          checked={requireShift}
          onCheckedChange={handleRequireToggle}
          disabled={requireSaving}
          aria-label="Exigir caja abierta para cobrar"
        />
      </div>

      <div className="border border-border rounded-xl p-4 bg-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm">{shift ? "Ventas del turno" : "Cierre actual"}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{summary.ordersCount} pedidos</span>
            <button
              type="button"
              onClick={() => setShowSnapshot(true)}
              title="Vista parcial sin cerrar (X)"
              className="text-xs font-medium text-primary underline"
            >
              👁 Vista parcial
            </button>
          </div>
        </div>
        {methods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {shift ? "Sin cobros desde la apertura." : "Sin cobros desde el último cierre."}
          </p>
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
        {(summary.senasCount || 0) > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            + {money(summary.senasTotal)} en señas cobradas con saldo pendiente (ya están en el cajón)
          </p>
        )}
        <div className="border-t border-border mt-3 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-sm font-bold tabular-nums">{money(summary.netTotal)}</p>
            <p className="text-[10px] text-muted-foreground">Neto cobrado</p>
          </div>
          <div>
            <p className="text-sm font-bold tabular-nums">{money(summary.cashTotal)}</p>
            <p className="text-[10px] text-muted-foreground">Efectivo ventas</p>
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

      {shift && movements.length > 0 && (
        <div className="border border-border rounded-xl p-4 bg-card">
          <h3 className="font-medium text-sm mb-3">Movimientos del turno</h3>
          <div className="space-y-2">
            {movements.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    <span className={m.kind === "ingreso" ? "text-green-600" : "text-red-600"}>
                      {m.kind === "ingreso" ? "+" : "−"}
                    </span>{" "}
                    {m.reason}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDateTime(m.created_at)}
                    {m.created_by_name ? ` · ${m.created_by_name}` : ""}
                  </p>
                </div>
                <span className={`font-bold tabular-nums flex-shrink-0 ${m.kind === "ingreso" ? "text-green-600" : "text-red-600"}`}>
                  {m.kind === "ingreso" ? "+" : "−"}{money(m.amount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!shift && (
        <div className="border border-border rounded-xl p-4 bg-card">
          <h3 className="font-medium text-sm mb-1">Arqueo</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Contá el efectivo de la caja (obligatorio para cerrar): el sistema espera {money(summary.cashTotal)}.
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
            disabled={saving || declared == null || declared < 0}
          >
            {saving ? "Cerrando..." : declared == null ? "🔒 Contá el efectivo para cerrar" : "🔒 Cerrar caja (Z)"}
          </Button>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            Congela los cobros de este período y arranca uno nuevo desde ahora.
          </p>
        </div>
      )}

      <div className="border border-border rounded-xl p-4 bg-card">
        <h3 className="font-medium text-sm mb-1">Reporte por rango</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Consolidado de cierres (estilo ZZ) para archivar o llevar al contador.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Desde</label>
            <input
              type="date"
              value={repFrom}
              onChange={(e) => setRepFrom(e.target.value)}
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0"
            />
          </div>
          <div className="min-w-0">
            <label className="text-xs text-muted-foreground">Hasta</label>
            <input
              type="date"
              value={repTo}
              onChange={(e) => setRepTo(e.target.value)}
              className="mt-1 w-full h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button type="button" variant="outline" onClick={loadReport} disabled={repLoading}>
            {repLoading ? "Cargando..." : "Ver resumen"}
          </Button>
          <a
            href={`/vendor/cierres/reporte?from=${encodeURIComponent(repFrom)}&to=${encodeURIComponent(repTo)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button type="button" variant="outline" className="w-full">📄 A4</Button>
          </a>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`/api/vendor/cash-closing/report?from=${encodeURIComponent(repFrom)}&to=${encodeURIComponent(repTo)}&format=xlsx`}
            >
              <Button type="button" variant="outline" size="sm" className="w-full">XLSX</Button>
            </a>
            <a
              href={`/api/vendor/cash-closing/report?from=${encodeURIComponent(repFrom)}&to=${encodeURIComponent(repTo)}&format=csv`}
            >
              <Button type="button" variant="outline" size="sm" className="w-full">CSV</Button>
            </a>
          </div>
        </div>
        {report && (
          <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{report.count} cierres · {report.orders} pedidos</span>
              <span className="font-bold tabular-nums">{money(report.net)}</span>
            </div>
            {(Number(report.sobra) > 0 || Number(report.falta) > 0) && (
              <p className="text-xs text-muted-foreground">
                {Number(report.sobra) > 0 && `Sobra ${money(report.sobra)}`}
                {Number(report.sobra) > 0 && Number(report.falta) > 0 && " · "}
                {Number(report.falta) > 0 && `Falta ${money(report.falta)}`}
              </p>
            )}
          </div>
        )}
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
                        {c.opened_at != null && (
                          <p className="text-xs text-muted-foreground">
                            Turno{c.opened_by_name ? ` de ${c.opened_by_name}` : ""} · inicial {money(c.opening_amount)}
                          </p>
                        )}
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
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePrint(c.id)}
                        disabled={printingId === c.id}
                      >
                        🖨️ {printingId === c.id ? "Enviando..." : "Imprimir"}
                      </Button>
                      <a href={`/vendor/cierre/${c.id}`} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm">
                          📄 A4
                        </Button>
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {showSnapshot && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowSnapshot(false)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-lg space-y-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-display text-lg font-semibold">Vista parcial (X)</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Foto del momento: no cierra la caja ni congela nada.
              </p>
            </div>
            <div className="rounded-xl border border-border p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Período desde</span>
                <span className="tabular-nums">{fmtDateTime(summary.since)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pedidos</span>
                <span className="tabular-nums">{summary.ordersCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Neto cobrado</span>
                <span className="tabular-nums font-medium">{money(summary.netTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Efectivo ventas</span>
                <span className="tabular-nums">{money(summary.cashTotal)}</span>
              </div>
              {shift && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Fondo inicial</span>
                    <span className="tabular-nums">{money(shift.opening_amount)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Esperado ahora</span>
                    <span className="tabular-nums">{money(disponible)}</span>
                  </div>
                </>
              )}
            </div>
            {methods.length > 0 && (
              <div className="rounded-xl border border-border p-3 space-y-1.5 text-sm">
                {methods.map(([m, d]) => (
                  <div key={m} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {CASH_METHOD_LABELS[m] || m} <span className="text-xs">({d.count})</span>
                    </span>
                    <span className="tabular-nums">{money(d.total)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setShowSnapshot(false)}>
                Cerrar vista
              </Button>
              <Button type="button" onClick={handlePrintSnapshot} disabled={printingSnapshot}>
                {printingSnapshot ? "Enviando..." : "🖨️ Imprimir X"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {movKind && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => !movSaving && setMovKind(null)}>
          <div className="bg-card rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg font-semibold">
              {movKind === "ingreso" ? "+ Ingresar efectivo" : "− Retirar efectivo"}
            </h3>
            {movKind === "retiro" && disponible != null && (
              <p className="text-xs text-muted-foreground">Disponible: {money(disponible)}</p>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={movAmount}
                onChange={(e) => setMovAmount(e.target.value)}
                placeholder="Monto"
                aria-label="Monto del movimiento"
                className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <input
              type="text"
              value={movReason}
              onChange={(e) => setMovReason(e.target.value)}
              placeholder={movKind === "ingreso" ? "Motivo (ej: cambio, fondo extra)" : "Motivo (ej: pago proveedor, retiro parcial)"}
              aria-label="Motivo del movimiento"
              maxLength={140}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => setMovKind(null)} disabled={movSaving}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleMovement} disabled={movSaving}>
                {movSaving ? "Guardando..." : "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPreClose && shift && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !saving && setShowPreClose(false)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-lg space-y-4 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-semibold">Cerrar caja</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Período: {fmtDateTime(shift.opened_at)} → ahora
                  {shift.opened_by_name ? ` · abierta por ${shift.opened_by_name}` : ""}
                </p>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                Paso {preStep} de 2
              </span>
            </div>

            {preStep === 1 ? (
              <>
                <div className="rounded-xl border border-border p-3 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumen</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ingresos por ventas ({summary.ordersCount})</span>
                    <span className="tabular-nums font-medium">{money(summary.netTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monto inicial</span>
                    <span className="tabular-nums">{money(shift.opening_amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Efectivo de ventas</span>
                    <span className="tabular-nums">{money(summary.cashTotal)}</span>
                  </div>
                  {(summary.senasCount || 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Señas en efectivo</span>
                      <span className="tabular-nums">{money(summary.senasTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ingresos manuales</span>
                    <span className="tabular-nums text-green-600">+{money(ingresosTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Retiros manuales</span>
                    <span className="tabular-nums text-red-600">−{money(retirosTotal)}</span>
                  </div>
                  <div className="border-t border-border pt-1.5 flex justify-between font-bold">
                    <span>Efectivo esperado</span>
                    <span className="tabular-nums">{money(disponible)}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-3 space-y-1.5 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por método de pago</p>
                  {methods.length === 0 ? (
                    <p className="text-muted-foreground">Sin cobros en el turno.</p>
                  ) : (
                    methods.map(([m, d]) => (
                      <div key={m} className="flex justify-between">
                        <span className="text-muted-foreground">
                          {CASH_METHOD_LABELS[m] || m} <span className="text-xs">({d.count})</span>
                        </span>
                        <span className="tabular-nums">{money(d.total)}</span>
                      </div>
                    ))
                  )}
                </div>

                <div>
                  <h4 className="font-medium text-sm mb-1">Conteo físico (obligatorio)</h4>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm text-muted-foreground">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={cashDeclared}
                      onChange={(e) => setCashDeclared(e.target.value)}
                      placeholder="Efectivo contado en el cajón"
                      aria-label="Conteo físico de efectivo"
                      className="flex-1 min-w-0 h-10 rounded-md border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  {difference != null && (
                    <p className={`text-sm font-semibold ${difference === 0 ? "text-green-600" : "text-red-600"}`}>
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
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-3 resize-none"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  Revisá los números: si falta cargar algo (una venta, un movimiento), cancelá y hacelo antes de cerrar.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={() => setShowPreClose(false)} disabled={saving}>
                    Cancelar
                  </Button>
                  <Button type="button" onClick={() => setPreStep(2)} disabled={declared == null || declared < 0}>
                    {declared == null ? "Contá para seguir" : "Revisar cierre →"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center space-y-1">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Resultado del cierre</p>
                  <p className={`font-display text-2xl font-bold tabular-nums ${difference === 0 ? "text-green-600" : "text-red-600"}`}>
                    {difference == null || difference === 0
                      ? "Cuadra ✓"
                      : `${difference > 0 ? "Sobra" : "Falta"} ${money(Math.abs(difference))}`}
                  </p>
                  <div className="grid grid-cols-3 gap-2 pt-2 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Esperado</p>
                      <p className="font-bold tabular-nums">{money(disponible)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Contado</p>
                      <p className="font-bold tabular-nums">{money(declared)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Ventas</p>
                      <p className="font-bold tabular-nums">{money(summary.netTotal)}</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Al confirmar se congela el turno y se genera el Z. No se puede rectificar después.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" onClick={() => setPreStep(1)} disabled={saving}>
                    ← Volver
                  </Button>
                  <Button type="button" onClick={handleClose} disabled={saving}>
                    {saving ? "Cerrando..." : "🔒 Confirmar cierre"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
