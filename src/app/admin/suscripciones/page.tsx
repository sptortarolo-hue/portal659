"use client";

import { useEffect, useState, useCallback } from "react";
import DataTable, { Column } from "@/components/admin/data-table";
import SubscriptionModal, { SuscripcionRow, HistoryItem, SuscripcionMode } from "@/components/admin/subscription-modal";
import { VERTICALS } from "@/lib/config";
import { Ban, Pencil, Plus, ChevronDown, ChevronRight, Trash2, ArrowLeftRight } from "lucide-react";

type PlanOption = { id: string; slug: string; name: string; price_monthly: number };

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "bg-orange-100 text-orange-700",
  comercio: "bg-emerald-100 text-emerald-700",
  servicio: "bg-sky-100 text-sky-700",
  moda: "bg-violet-100 text-violet-700",
  salud: "bg-pink-100 text-pink-700",
  estetica: "bg-pink-100 text-pink-700",
};

const SUB_LABELS: Record<string, { label: string; cls: string }> = {
  trial: { label: "Prueba", cls: "bg-amber-100 text-amber-700" },
  active: { label: "Activo", cls: "bg-green-100 text-green-700" },
  expired: { label: "Vencido", cls: "bg-red-100 text-red-700" },
  past_due: { label: "Pago en revisión", cls: "bg-amber-100 text-amber-700" },
  cancelled: { label: "Cancelado", cls: "bg-gray-100 text-gray-600" },
  gratuito: { label: "Gratuito", cls: "bg-muted text-muted-foreground" },
};

function fmt(date: string | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toLocaleString("es-AR")}` : "-";
}

function methodLabel(m: string | null): string {
  return m === "efectivo" ? "Efectivo" : m === "transferencia" ? "Transferencia" : m === "mercadopago" ? "Mercado Pago" : "-";
}

export default function AdminSuscripcionesPage() {
  const [rows, setRows] = useState<SuscripcionRow[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterVertical, setFilterVertical] = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [filterPlan, setFilterPlan] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryItem[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [modal, setModal] = useState<{ row: SuscripcionRow; sub: HistoryItem | null; createNew: boolean; isLatest: boolean } | null>(null);
  // Circuito de pago por transferencia: cola de revisión + datos bancarios.
  const [payments, setPayments] = useState<any[]>([]);
  const [bank, setBank] = useState<any | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewMsg, setReviewMsg] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/suscripciones");
      const data = await res.json();
      if (!data.error) {
        setRows(data.subscriptions || []);
        setPlans(data.plans || []);
        setPayments(data.payments || []);
        setBank(data.bank || null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  async function reviewPayment(paymentId: string, approve: boolean, note?: string) {
    setReviewBusy(paymentId);
    setReviewMsg("");
    try {
      const res = await fetch("/api/admin/suscripciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: payVendorId(paymentId),
          action: approve ? "approve_payment" : "reject_payment",
          paymentId,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setReviewMsg(data.error || "No se pudo registrar la revisión");
      } else {
        setReviewMsg(approve ? "Pago aprobado: plan activado y recibo emitido." : "Pago rechazado: se avisó al comercio.");
      }
      await fetchData();
    } finally {
      setReviewBusy(null);
    }
  }

  function payVendorId(paymentId: string): string {
    return payments.find((p) => p.id === paymentId)?.vendor_id || "";
  }

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchHistory = useCallback(async (vendorId: string, force = false) => {
    setHistory((prev) => {
      if (!force && prev[vendorId]) return prev;
      return prev;
    });
    if (!force && history[vendorId]) return;
    setHistoryLoading(vendorId);
    try {
      const res = await fetch(`/api/admin/suscripciones?vendorId=${vendorId}`);
      const data = await res.json();
      if (!data.error) setHistory((prev) => ({ ...prev, [vendorId]: data.history || [] }));
    } finally {
      setHistoryLoading(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  function toggleExpand(row: SuscripcionRow) {
    if (expandedId === row.vendor_id) {
      setExpandedId(null);
    } else {
      setExpandedId(row.vendor_id);
      fetchHistory(row.vendor_id);
    }
  }

  async function handleSubmit(_mode: SuscripcionMode, payload: Record<string, unknown>) {
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
    const vendorId = payload.vendorId as string;
    await fetchData();
    if (vendorId) await fetchHistory(vendorId, true);
  }

  async function handleDelete(row: SuscripcionRow, sub: HistoryItem) {
    if (!confirm(`¿Borrar este período de "${row.store_name}" (${fmt(sub.current_period_start)} → ${fmt(sub.current_period_end)})?`)) return;
    const res = await fetch("/api/admin/suscripciones", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: row.vendor_id, subscriptionId: sub.id }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      await fetchHistory(row.vendor_id, true);
      fetchData();
    } else {
      alert(data.error || "No se pudo borrar");
    }
  }

  async function handleSync(row: SuscripcionRow, sub: HistoryItem) {
    if (!confirm(`¿Poner como vigente este período de "${row.store_name}"? Se pisa plan/estado/vencimiento del comercio.`)) return;
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: row.vendor_id, action: "sync_vendor_from_subscription", subscriptionId: sub.id }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      fetchData();
    } else {
      alert(data.error || "No se pudo sincronizar");
    }
  }

  async function handleCancel(row: SuscripcionRow) {
    if (!confirm(`¿Cancelar el plan de "${row.store_name}"?`)) return;
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: row.vendor_id, action: "cancel" }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      fetchData();
      if (expandedId === row.vendor_id) fetchHistory(row.vendor_id, true);
    }
  }

  const filtered = rows.filter((r) => {
    if (filterVertical && r.vertical !== filterVertical) return false;
    if (filterPlan && r.plan_slug !== filterPlan) return false;
    if (filterEstado) {
      if (filterEstado === "pago" && r.paid) return false;
      if (filterEstado === "sinpagar" && !r.paid) return false;
      if (filterEstado === "vencido" && !(r.effective_status === "expired")) return false;
      if (filterEstado === "activo" && !(r.effective_status === "active" || r.effective_status === "trial")) return false;
    }
    return true;
  });

  const activePaid = rows.filter((r) => r.effective_status === "active" && r.paid).length;
  const porVencer = rows.filter((r) => r.effective_status === "active" && r.expires_in_days != null && r.expires_in_days <= 7).length;
  const sinPagar = rows.filter((r) => (r.effective_status === "active" || r.effective_status === "trial") && !r.paid).length;
  const vencidos = rows.filter((r) => r.effective_status === "expired").length;

  const columns: Column<SuscripcionRow>[] = [
    {
      key: "store_name",
      label: "Comercio",
      sortable: true,
      render: (r) => (
        <div className="flex items-start gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); toggleExpand(r); }}
            className="mt-0.5 p-1 rounded-md hover:bg-muted transition-colors"
            title={expandedId === r.vendor_id ? "Ocultar historial" : "Ver historial"}
          >
            {expandedId === r.vendor_id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
          <div>
            <p className="font-medium text-sm">{r.store_name}</p>
            <p className="text-xs text-muted-foreground">{r.slug || "-"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "vertical",
      label: "Vertical",
      sortable: true,
      render: (r) => (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${VERTICAL_COLORS[r.vertical] || "bg-muted text-muted-foreground"}`}>
          {VERTICALS.find((vt) => vt.slug === r.vertical)?.name || r.vertical}
        </span>
      ),
    },
    {
      key: "plan_name",
      label: "Plan",
      render: (r) => (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.plan_slug === "gratuito" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
          {r.plan_name}
        </span>
      ),
    },
    {
      key: "effective_status",
      label: "Estado",
      render: (r) => {
        const m = SUB_LABELS[r.effective_status] || SUB_LABELS.gratuito;
        return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${m.cls}`}>{m.label}</span>;
      },
    },
    {
      key: "plan_expires_at",
      label: "Vence",
      sortable: true,
      render: (r) => (
        <div className="text-xs">
          <p>{fmt(r.plan_expires_at)}</p>
          {r.expires_in_days != null && r.plan_slug !== "gratuito" && (
            <p className={`text-[10px] ${r.expires_in_days <= 7 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
              {r.expires_in_days} días
            </p>
          )}
        </div>
      ),
    },
    {
      key: "paid",
      label: "Pago",
      render: (r) => (
        <div className="text-xs">
          {r.paid ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Pagado
            </span>
          ) : r.plan_slug !== "gratuito" && (r.effective_status === "active" || r.effective_status === "trial") ? (
            <span className="inline-flex items-center gap-1 text-red-600">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Sin pagar
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
          {r.amount != null && <p className="text-[10px] text-muted-foreground">{fmtMoney(r.amount)}</p>}
          {r.paid_at && <p className="text-[10px] text-muted-foreground/60">{fmt(r.paid_at)}</p>}
        </div>
      ),
    },
    {
      key: "payment_method",
      label: "Método",
      render: (r) => <span className="text-xs">{methodLabel(r.payment_method)}</span>,
    },
  ];

  const expandedRow = expandedId ? rows.find((r) => r.vendor_id === expandedId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Suscripciones</h1>
        <span className="text-sm text-muted-foreground">{rows.length} comercios</span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-2xl font-bold">{activePaid}</p>
          <p className="text-xs text-muted-foreground">Planes activos pagos</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${sinPagar > 0 ? "text-red-600" : ""}`}>{sinPagar}</p>
          <p className="text-xs text-muted-foreground">Sin pagar</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${porVencer > 0 ? "text-amber-600" : ""}`}>{porVencer}</p>
          <p className="text-xs text-muted-foreground">Vencen en ≤7 días</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${vencidos > 0 ? "text-red-600" : ""}`}>{vencidos}</p>
          <p className="text-xs text-muted-foreground">Vencidos</p>
        </div>
      </div>

      {/* Cola de revisión de pagos por transferencia */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm">
            Pagos por transferencia por revisar ({payments.length})
          </h2>
          <button
            onClick={() => setBankOpen((v) => !v)}
            className="text-xs text-primary font-medium hover:underline"
          >
            {bankOpen ? "Cerrar datos bancarios" : "Datos bancarios del portal"}
          </button>
        </div>

        {bankOpen && (
          <div className="grid sm:grid-cols-2 gap-3 rounded-xl border border-border p-4">
            {(
              [
                ["alias", "Alias"],
                ["cbu", "CBU"],
                ["titular", "Titular"],
                ["qr_url", "URL del QR"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-xs space-y-1">
                <span className="text-muted-foreground">{label}</span>
                <input
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={(bank as any)?.[key] || ""}
                  onChange={(e) => setBank((b: any) => ({ ...(b || {}), [key]: e.target.value }))}
                />
              </label>
            ))}
            <label className="text-xs space-y-1 sm:col-span-2">
              <span className="text-muted-foreground">Nota interna</span>
              <input
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={(bank as any)?.notes || ""}
                onChange={(e) => setBank((b: any) => ({ ...(b || {}), notes: e.target.value }))}
              />
            </label>
            <div className="sm:col-span-2 flex justify-end">
              <button
                className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
                onClick={async () => {
                  await fetch("/api/admin/suscripciones", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ vendorId: "00000000-0000-0000-0000-000000000000", action: "save_bank", bank }),
                  });
                  await fetchData();
                }}
              >
                Guardar datos bancarios
              </button>
            </div>
          </div>
        )}

        {reviewMsg && <p className="text-xs text-muted-foreground">{reviewMsg}</p>}

        {payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hay pagos pendientes de revisión.</p>
        ) : (
          <div className="divide-y divide-border">
            {payments.map((p) => {
              const stale =
                !p.comprobante_at &&
                Date.now() - new Date(p.created_at).getTime() > 48 * 3600 * 1000;
              return (
                <div key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {p.store_name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {p.plan_name} · ${Number(p.amount).toLocaleString("es-AR")}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {new Date(p.created_at).toLocaleString("es-AR")}
                      {p.comprobante_at
                        ? ` · comprobante subido ${new Date(p.comprobante_at).toLocaleString("es-AR")}`
                        : " · sin comprobante"}
                      {stale ? " ⚠ +48h" : ""} · ref {p.reference}
                    </p>
                  </div>
                  {p.comprobante_url && (
                    <a
                      href={p.comprobante_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary font-medium hover:underline"
                    >
                      Ver comprobante
                    </a>
                  )}
                  <div className="flex gap-2">
                    <button
                      disabled={reviewBusy === p.id}
                      onClick={() => reviewPayment(p.id, true)}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {reviewBusy === p.id ? "..." : "Aprobar"}
                    </button>
                    <button
                      disabled={reviewBusy === p.id}
                      onClick={() => {
                        const reason = prompt("Motivo del rechazo (se le envía al comercio):");
                        if (reason) reviewPayment(p.id, false, reason);
                      }}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filterVertical}
          onChange={(e) => setFilterVertical(e.target.value)}
        >
          <option value="">Todas las verticales</option>
          {VERTICALS.map((v) => (
            <option key={v.slug} value={v.slug}>{v.name}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
        >
          <option value="">Todos los planes</option>
          {plans.map((p) => (
            <option key={p.id} value={p.slug}>{p.name}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="sinpagar">Sin pagar</option>
          <option value="pago">Pagados</option>
          <option value="vencido">Vencidos</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          searchPlaceholder="Buscar comercio..."
          searchKeys={["store_name", "slug"]}
          pageSize={15}
          emptyMessage="No hay suscripciones"
          actions={(r) => (
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => setModal({ row: r, sub: null, createNew: false, isLatest: true })}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                title="Editar datos (plan, fechas, pago)"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {r.plan_slug !== "gratuito" && r.effective_status !== "cancelled" && r.effective_status !== "expired" && (
                <button
                  onClick={() => handleCancel(r)}
                  className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
                  title="Cancelar plan"
                >
                  <Ban className="h-3.5 w-3.5 text-red-500" />
                </button>
              )}
            </div>
          )}
        />
      )}

      {expandedRow && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm">Historial — {expandedRow.store_name}</h2>
            <button
              onClick={() => setModal({ row: expandedRow, sub: null, createNew: true, isLatest: true })}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Período manual
            </button>
          </div>
          {historyLoading === expandedRow.vendor_id ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : (history[expandedRow.vendor_id] || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin períodos registrados. Creá uno manual con el botón de arriba.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-2 font-medium">Período</th>
                    <th className="py-2 pr-2 font-medium">Plan / Estado</th>
                    <th className="py-2 pr-2 font-medium">Pago</th>
                    <th className="py-2 pr-2 font-medium">Nota</th>
                    <th className="py-2 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {(history[expandedRow.vendor_id] || []).map((h, i) => {
                    const sm = SUB_LABELS[h.status] || SUB_LABELS.gratuito;
                    return (
                      <tr key={h.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-2">
                          <p>{fmt(h.current_period_start)} → {fmt(h.current_period_end)}</p>
                          {i === 0 && <p className="text-[10px] text-primary font-medium">vigente</p>}
                        </td>
                        <td className="py-2 pr-2">
                          <p className="font-medium">{h.plan_name || h.plan_slug}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sm.cls}`}>{sm.label}</span>
                        </td>
                        <td className="py-2 pr-2">
                          {h.paid_at ? (
                            <span className="text-green-700 font-medium">Pagado</span>
                          ) : (
                            <span className="text-red-600">Sin pagar</span>
                          )}
                          <p className="text-muted-foreground">{fmtMoney(h.amount)} · {methodLabel(h.payment_method)}</p>
                          {h.paid_at && <p className="text-muted-foreground/60">{fmt(h.paid_at)}</p>}
                        </td>
                        <td className="py-2 pr-2 max-w-[220px]">
                          <p className="truncate text-muted-foreground" title={h.note || ""}>{h.note || "-"}</p>
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              onClick={() => setModal({ row: expandedRow, sub: h, createNew: false, isLatest: i === 0 })}
                              className="p-1.5 rounded-md hover:bg-muted transition-colors"
                              title="Editar este período"
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            <button
                              onClick={() => handleSync(expandedRow, h)}
                              className="p-1.5 rounded-md hover:bg-muted transition-colors"
                              title="Poner como vigente"
                            >
                              <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            <button
                              onClick={() => handleDelete(expandedRow, h)}
                              className="p-1.5 rounded-md hover:bg-red-50 transition-colors"
                              title="Borrar período"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <SubscriptionModal
        open={!!modal}
        onClose={() => setModal(null)}
        mode={modal?.createNew ? "create" : "edit"}
        row={modal?.row || null}
        plans={plans}
        subscription={modal?.sub ?? null}
        createNew={modal?.createNew}
        isLatest={modal?.isLatest}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
