"use client";

import { useEffect, useState, useCallback } from "react";
import DataTable, { Column } from "@/components/admin/data-table";
import SubscriptionModal, { SuscripcionRow, HistoryItem, SuscripcionMode } from "@/components/admin/subscription-modal";
import { VERTICALS } from "@/lib/config";
import { planPriceFor, formatPrice } from "@/lib/plans";
import {
  Ban, Pencil, Plus, ChevronDown, ChevronRight, Trash2, ArrowLeftRight, Receipt,
} from "lucide-react";

type PlanOption = { id: string; slug: string; name: string; price_monthly: number };
type QueueItem = {
  id: string;
  amount: number;
  expected_amount: number;
  amount_mismatch: boolean;
  reference: string;
  created_at: string;
  comprobante_url: string | null;
  comprobante_name: string | null;
  comprobante_at: string | null;
  age_hours: number | null;
  vendor_id: string;
  store_name: string;
  slug: string;
  vertical: string;
  plan_name: string;
  plan_expires_at: string | null;
};
type ReviewedItem = {
  id: string;
  amount: number;
  method: string;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
  vendor_id: string;
  store_name: string;
  plan_name: string;
};
type ReceiptItem = {
  id: string;
  amount: number;
  plan_name: string;
  method: string;
  seq: number;
  year: number;
  issued_at: string;
  emailed_at: string | null;
};

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
  past_due: { label: "Pago en revisión", cls: "bg-amber-100 text-amber-700" },
  expired: { label: "Vencido", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Cancelado", cls: "bg-gray-100 text-gray-600" },
  gratuito: { label: "Gratuito", cls: "bg-muted text-muted-foreground" },
};

const REJECT_PRESETS = [
  "El monto no coincide con el plan",
  "El comprobante no se entiende",
  "No identificamos la transferencia",
  "El comprobante está duplicado",
  "Pagaste un plan que no corresponde a tu rubro",
];

const money = (n: number | null) => (n != null ? `$${Number(n).toLocaleString("es-AR")}` : "-");

function fmt(date: string | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toLocaleString("es-AR")}` : "-";
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "-";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${Math.max(1, mins)} min`;
  const hs = Math.round(mins / 60);
  if (hs < 24) return `hace ${hs} h`;
  return `hace ${Math.round(hs / 24)} d`;
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
  const [paymentsByVendor, setPaymentsByVendor] = useState<Record<string, any[]>>({});
  const [receiptsByVendor, setReceiptsByVendor] = useState<Record<string, ReceiptItem[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [modal, setModal] = useState<{ row: SuscripcionRow; sub: HistoryItem | null; createNew: boolean; isLatest: boolean } | null>(null);

  // Cola de revisión + datos bancarios.
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [reviewed, setReviewed] = useState<ReviewedItem[]>([]);
  const [queueTab, setQueueTab] = useState<"pending" | "reviewed">("pending");
  const [bank, setBank] = useState<any | null>(null);
  const [bankComplete, setBankComplete] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewMsg, setReviewMsg] = useState("");
  // Modales de la cola.
  const [approveTarget, setApproveTarget] = useState<QueueItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ item: QueueItem; preset: string; extra: string } | null>(null);
  const [nudgeBusy, setNudgeBusy] = useState<string | null>(null);
  // Emisión manual de recibo.
  const [emitRow, setEmitRow] = useState<SuscripcionRow | null>(null);
  const [emitForm, setEmitForm] = useState<{
    planId: string;
    amount: string;
    periodStart: string;
    periodEnd: string;
    method: "transferencia" | "efectivo";
    renew: boolean;
    note: string;
    promoPct: number | null;
    promoListPrice: number | null;
  } | null>(null);
  const [emitBusy, setEmitBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/suscripciones");
      const data = await res.json();
      if (!data.error) {
        setRows(data.subscriptions || []);
        setPlans(data.plans || []);
        setQueue(data.pending || []);
        setReviewed(data.reviewed || []);
        setBank(data.bank || null);
        setBankComplete(!!data.bankComplete);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchHistory = useCallback(async (vendorId: string, force = false) => {
    if (!force && history[vendorId]) return;
    setHistoryLoading(vendorId);
    try {
      const res = await fetch(`/api/admin/suscripciones?vendorId=${vendorId}`);
      const data = await res.json();
      if (!data.error) {
        setHistory((prev) => ({ ...prev, [vendorId]: data.history || [] }));
        setPaymentsByVendor((prev) => ({ ...prev, [vendorId]: data.payments || [] }));
        setReceiptsByVendor((prev) => ({ ...prev, [vendorId]: data.receipts || [] }));
      }
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
      void fetchHistory(row.vendor_id);
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
    if (res.ok) {
      await fetchData();
      await fetchHistory(row.vendor_id, true);
    }
  }

  async function handleSync(row: SuscripcionRow, sub: HistoryItem) {
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: row.vendor_id, action: "sync_vendor_from_subscription", subscriptionId: sub.id }),
    });
    const data = await res.json();
    if (!res.ok || data.error) alert(data.error || "No se pudo sincronizar");
    else {
      await fetchData();
      await fetchHistory(row.vendor_id, true);
    }
  }

  async function handleCancel(row: SuscripcionRow) {
    const note = prompt("Motivo de la cancelación (opcional):");
    if (note === null) return;
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: row.vendor_id, action: "cancel", note: note || "Cancelado por administrador" }),
    });
    const data = await res.json();
    if (!res.ok || data.error) alert(data.error || "No se pudo cancelar");
    else await fetchData();
  }

  async function patchQueue(payload: Record<string, unknown>) {
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setReviewMsg(data.error || "No se pudo registrar la revisión");
      return null;
    }
    await fetchData();
    return data;
  }

  async function approve(item: QueueItem) {
    setReviewBusy(item.id);
    setReviewMsg("");
    const data = await patchQueue({ vendorId: item.vendor_id, action: "approve_payment", paymentId: item.id });
    setReviewBusy(null);
    setApproveTarget(null);
    setReviewMsg(
      data
        ? `Aprobado: plan activo hasta el ${fmt(item.plan_expires_at)} · recibo ${data.receipt?.number ?? "emitido"}${data.receipt ? "" : " (no se pudo emitir el recibo)"}`
        : "No se pudo aprobar"
    );
  }

  async function reject(item: QueueItem, preset: string, extra: string) {
    setReviewBusy(item.id);
    setReviewMsg("");
    const note = [preset, extra].filter(Boolean).join(" — ");
    const data = await patchQueue({
      vendorId: item.vendor_id,
      action: "reject_payment",
      paymentId: item.id,
      reasonPreset: preset,
      note: extra,
    });
    setReviewBusy(null);
    setRejectTarget(null);
    if (data) setReviewMsg(`Rechazado: ${note || "sin motivo"}`);
  }

  async function nudge(item: QueueItem) {
    setNudgeBusy(item.id);
    const data = await patchQueue({ vendorId: item.vendor_id, action: "nudge_pending", paymentId: item.id });
    setNudgeBusy(null);
    setReviewMsg(data?.mailed ? "Recordatorio enviado por mail + push." : data ? "Recordatorio enviado por push." : "No se pudo enviar el recordatorio");
  }

  async function resendReceipt(vendorId: string, r: ReceiptItem) {
    setResendBusy(r.id);
    const data = await patchQueue({ vendorId, action: "resend_receipt", receiptId: r.id });
    setResendBusy(null);
    setReviewMsg(data ? `Recibo ${r.year}/${String(r.seq).padStart(4, "0")} reenviado por mail.` : "No se pudo reenviar el recibo");
  }

  function openEmit(row: SuscripcionRow) {
    const plan = plans.find((p) => p.id === row.plan_id) ?? plans.find((p) => p.slug !== "gratuito");
    if (!plan) {
      setReviewMsg("El comercio no tiene un plan asignado: asignalo antes de emitir el recibo.");
      return;
    }
    const price = planPriceFor(plan as any);
    const start = new Date();
    const end = new Date(start.getTime() + (price?.months || 1) * 30 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setEmitForm({
      planId: plan.id,
      amount: String(price?.amount ?? plan.price_monthly ?? ""),
      periodStart: iso(start),
      periodEnd: iso(end),
      method: "transferencia",
      renew: true,
      note: "",
      promoPct: price?.isPromo ? price.offPct ?? null : null,
      promoListPrice: price?.isPromo ? price.listPrice : null,
    });
    setEmitRow(row);
  }

  async function submitEmit() {
    if (!emitRow || !emitForm) return;
    setEmitBusy(true);
    const data = await patchQueue({
      vendorId: emitRow.vendor_id,
      action: "emit_receipt",
      ...emitForm,
      amount: Number(emitForm.amount),
      periodStart: new Date(emitForm.periodStart).toISOString(),
      periodEnd: new Date(emitForm.periodEnd).toISOString(),
    });
    setEmitBusy(false);
    if (data) {
      setReviewMsg(`Recibo X ${data.receipt?.number ?? ""} emitido${emitForm.renew ? " y plan actualizado" : ""}.`);
      setEmitRow(null);
      setEmitForm(null);
      await fetchHistory(emitRow.vendor_id, true);
    }
  }

  const filtered = rows.filter((r) => {
    if (filterVertical && r.vertical !== filterVertical) return false;
    if (filterPlan && r.plan_slug !== filterPlan) return false;
    if (filterEstado === "activo" && r.effective_status !== "active") return false;
    if (filterEstado === "sinpagar" && r.paid) return false;
    if (filterEstado === "pago" && !r.paid) return false;
    if (filterEstado === "vencido" && r.effective_status !== "expired") return false;
    if (filterEstado === "revision" && r.effective_status !== "past_due") return false;
    return true;
  });

  const activePaid = rows.filter((r) => r.effective_status === "active" && r.paid).length;
  const porVencer = rows.filter((r) => r.effective_status === "active" && r.expires_in_days != null && r.expires_in_days <= 7).length;
  const sinPagar = rows.filter((r) => (r.effective_status === "active" || r.effective_status === "trial") && !r.paid).length;
  const vencidos = rows.filter((r) => r.effective_status === "expired").length;
  const porAcreditar = queue.reduce((s, p) => s + (p.amount || 0), 0);
  const conComprobante = queue.filter((p) => p.comprobante_at).length;
  const stale48 = queue.filter((p) => !p.comprobante_at && (p.age_hours ?? 0) > 48).length;

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
            title={expandedId === r.vendor_id ? "Ocultar detalle" : "Ver detalle"}
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
          ) : r.plan_slug !== "gratuito" && (r.effective_status === "active" || r.effective_status === "trial" || r.effective_status === "past_due") ? (
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
  const expandedPayments = expandedRow ? paymentsByVendor[expandedRow.vendor_id] || [] : [];
  const expandedReceipts = expandedRow ? receiptsByVendor[expandedRow.vendor_id] || [] : [];

  // Timeline: períodos + pagos + recibos en una sola lista por fecha.
  const timeline = [
    ...(expandedRow ? history[expandedRow.vendor_id] || [] : []).map((h) => ({
      kind: "period" as const,
      date: h.current_period_start,
      data: h,
    })),
    ...expandedPayments.map((p) => ({ kind: "payment" as const, date: p.created_at, data: p })),
    ...expandedReceipts.map((r) => ({ kind: "receipt" as const, date: r.issued_at, data: r })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Suscripciones</h1>
        <span className="text-sm text-muted-foreground">{rows.length} comercios</span>
      </div>

      {/* KPIs operativos */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-2xl font-bold">{activePaid}</p>
          <p className="text-xs text-muted-foreground">Activos pagos</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${sinPagar > 0 ? "text-red-600" : ""}`}>{sinPagar}</p>
          <p className="text-xs text-muted-foreground">Sin pagar</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${porVencer > 0 ? "text-amber-600" : ""}`}>{porVencer}</p>
          <p className="text-xs text-muted-foreground">Vencen ≤7 días</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${vencidos > 0 ? "text-red-600" : ""}`}>{vencidos}</p>
          <p className="text-xs text-muted-foreground">Vencidos</p>
        </div>
        <div className={`rounded-xl border bg-card p-4 ${queue.length > 0 ? "border-primary" : "border-border"}`}>
          <p className="text-2xl font-bold">{queue.length}</p>
          <p className="text-xs text-muted-foreground">A acreditar · {money(porAcreditar)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={`text-2xl font-bold ${stale48 > 0 ? "text-red-600" : ""}`}>{stale48}</p>
          <p className="text-xs text-muted-foreground">Sin comprobante +48h</p>
        </div>
      </div>

      {/* Datos bancarios del portal (siempre visibles) */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold text-sm">🏦 Datos de cobro del portal</h2>
          <span className="text-[11px] text-muted-foreground">Los usan los comercios para transferir</span>
        </div>
        {!bankComplete && (
          <p className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            Faltan los datos de cobro: los comercios no pueden transferir y los avisos no muestran dónde pagar.
          </p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(["alias", "cbu", "titular", "qr_url", "whatsapp", "notes"] as const).map((key) => (
            <label key={key} className="text-xs space-y-1">
              <span className="text-muted-foreground">
                {key === "qr_url" ? "URL del QR" : key === "whatsapp" ? "WhatsApp de ayuda" : key === "notes" ? "Nota interna" : key[0].toUpperCase() + key.slice(1)}
              </span>
              <input
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={(bank as any)?.[key] || ""}
                onChange={(e) => setBank((b: any) => ({ ...(b || {}), [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white"
            onClick={async () => {
              const res = await fetch("/api/admin/suscripciones", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vendorId: rows[0]?.vendor_id || "00000000-0000-0000-0000-000000000000", action: "save_bank", bank }),
              });
              if (res.ok) {
                setReviewMsg("Datos bancarios guardados.");
                await fetchData();
              }
            }}
          >
            Guardar datos bancarios
          </button>
        </div>
      </div>

      {/* Cola de revisión: el trabajo del admin */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display font-semibold text-sm">
            Pagos por transferencia
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {queueTab === "pending"
                ? `${conComprobante} listos para decidir · ${queue.length - conComprobante} esperando comprobante`
                : `${reviewed.length} revisados (30 días)`}
            </span>
          </h2>
          <div className="flex gap-1">
            <button
              onClick={() => setQueueTab("pending")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${queueTab === "pending" ? "bg-primary text-white" : "border border-border"}`}
            >
              Para revisar ({queue.length})
            </button>
            <button
              onClick={() => setQueueTab("reviewed")}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${queueTab === "reviewed" ? "bg-primary text-white" : "border border-border"}`}
            >
              Revisados ({reviewed.length})
            </button>
          </div>
        </div>

        {reviewMsg && <p className="text-xs text-muted-foreground">{reviewMsg}</p>}

        {queueTab === "pending" ? (
          queue.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay pagos pendientes. Cuando un comercio inicie una renovación, aparece acá.</p>
          ) : (
            <div className="divide-y divide-border">
              {queue.map((p) => (
                <div key={p.id} className="py-3 flex flex-col lg:flex-row lg:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {p.store_name}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {p.plan_name} · {money(p.amount)}
                      </span>
                      {p.amount_mismatch && (
                        <span className="ml-2 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-bold px-1.5 py-0.5">
                          ⚠ el plan hoy sale {money(p.expected_amount)}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      iniciado {fmtAgo(p.created_at)}
                      {p.comprobante_at
                        ? ` · comprobante ${fmtAgo(p.comprobante_at)}`
                        : (p.age_hours ?? 0) > 48
                          ? " · ⚠ sin comprobante +48h"
                          : " · sin comprobante"}
                      {" "}· ref {p.reference}
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
                  <div className="flex flex-wrap gap-2">
                    {!p.comprobante_at && (
                      <button
                        disabled={nudgeBusy === p.id}
                        onClick={() => nudge(p)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                        title="Enviar mail + push recordando que falta el comprobante"
                      >
                        {nudgeBusy === p.id ? "..." : "Recordarle"}
                      </button>
                    )}
                    <button
                      disabled={reviewBusy === p.id}
                      onClick={() => setApproveTarget(p)}
                      className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      Aprobar
                    </button>
                    <button
                      disabled={reviewBusy === p.id}
                      onClick={() => setRejectTarget({ item: p, preset: REJECT_PRESETS[0], extra: "" })}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : reviewed.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no hay pagos revisados en los últimos 30 días.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-2 font-medium">Comercio</th>
                  <th className="py-2 pr-2 font-medium">Plan</th>
                  <th className="py-2 pr-2 font-medium">Monto</th>
                  <th className="py-2 pr-2 font-medium">Método</th>
                  <th className="py-2 pr-2 font-medium">Resultado</th>
                  <th className="py-2 font-medium">Revisado</th>
                </tr>
              </thead>
              <tbody>
                {reviewed.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-2 font-medium">{p.store_name}</td>
                    <td className="py-2 pr-2">{p.plan_name}</td>
                    <td className="py-2 pr-2">{fmtMoney(p.amount)}</td>
                    <td className="py-2 pr-2">{methodLabel(p.method)}</td>
                    <td className="py-2 pr-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${p.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {p.status === "approved" ? "Aprobado" : "Rechazado"}
                      </span>
                      {p.review_note && <p className="text-muted-foreground truncate max-w-[220px]" title={p.review_note}>{p.review_note}</p>}
                    </td>
                    <td className="py-2">{p.reviewed_at ? new Date(p.reviewed_at).toLocaleString("es-AR") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filterVertical} onChange={(e) => setFilterVertical(e.target.value)}>
          <option value="">Todas las verticales</option>
          {VERTICALS.map((v) => (
            <option key={v.slug} value={v.slug}>{v.name}</option>
          ))}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filterPlan} onChange={(e) => setFilterPlan(e.target.value)}>
          <option value="">Todos los planes</option>
          {plans.map((p) => (
            <option key={p.id} value={p.slug}>{p.name}</option>
          ))}
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={filterEstado} onChange={(e) => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="sinpagar">Sin pagar</option>
          <option value="pago">Pagados</option>
          <option value="vencido">Vencidos</option>
          <option value="revision">Pago en revisión</option>
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
                onClick={() => openEmit(r)}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                title="Emitir recibo a mano (pago por transferencia o efectivo)"
              >
                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
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

      {/* Detalle del comercio: timeline períodos + pagos + recibos */}
      {expandedRow && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm">Detalle — {expandedRow.store_name}</h2>
            <div className="flex gap-2">
              <button
                onClick={() => openEmit(expandedRow)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input hover:bg-muted transition-colors"
              >
                <Receipt className="h-3.5 w-3.5" /> Emitir recibo
              </button>
              <button
                onClick={() => setModal({ row: expandedRow, sub: null, createNew: true, isLatest: true })}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Período manual
              </button>
            </div>
          </div>

          {historyLoading === expandedRow.vendor_id ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin movimientos. Creá un período o emití un recibo con los botones de arriba.</p>
          ) : (
            <div className="space-y-2">
              {timeline.map((item) => {
                if (item.kind === "period") {
                  const h = item.data as HistoryItem;
                  const i = (history[expandedRow.vendor_id] || []).findIndex((x) => x.id === h.id);
                  const sm = SUB_LABELS[h.status] || SUB_LABELS.gratuito;
                  return (
                    <div key={`p-${h.id}`} className="rounded-lg border border-border p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Período {h.plan_name || h.plan_slug}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {fmt(h.current_period_start)} → {fmt(h.current_period_end)} · {fmtMoney(h.amount)} · {methodLabel(h.payment_method)}
                          {i === 0 ? " · vigente" : ""}
                        </p>
                        {h.note && <p className="text-[11px] text-muted-foreground truncate" title={h.note}>{h.note}</p>}
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sm.cls}`}>{sm.label}</span>
                      <div className="flex gap-1">
                        <button onClick={() => setModal({ row: expandedRow, sub: h, createNew: false, isLatest: i === 0 })} className="p-1.5 rounded-md hover:bg-muted" title="Editar"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={() => handleSync(expandedRow, h)} className="p-1.5 rounded-md hover:bg-muted" title="Poner como vigente"><ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" /></button>
                        <button onClick={() => handleDelete(expandedRow, h)} className="p-1.5 rounded-md hover:bg-red-50" title="Borrar"><Trash2 className="h-3.5 w-3.5 text-red-500" /></button>
                      </div>
                    </div>
                  );
                }
                if (item.kind === "payment") {
                  const p = item.data as any;
                  const badge =
                    p.status === "approved"
                      ? "bg-green-100 text-green-700"
                      : p.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700";
                  return (
                    <div key={`pay-${p.id}`} className="rounded-lg border border-border p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Pago {p.plan_name ?? "plan"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {fmt(p.created_at)} · {fmtMoney(p.amount)} · {methodLabel(p.method)}
                          {p.comprobante_at ? " · con comprobante" : " · sin comprobante"}
                          {p.review_note ? ` · ${p.review_note}` : ""}
                        </p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge}`}>
                        {p.status === "approved" ? "Acreditado" : p.status === "rejected" ? "Rechazado" : "En revisión"}
                      </span>
                    </div>
                  );
                }
                const r = item.data as ReceiptItem;
                return (
                  <div key={`r-${r.id}`} className="rounded-lg border border-border p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <a href={`/vendor/suscripcion/recibo/${r.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline">
                        Recibo X {String(r.seq).padStart(4, "0")}/{r.year}
                      </a>
                      <p className="text-[11px] text-muted-foreground">
                        {fmt(r.issued_at)} · {fmtMoney(r.amount)} · plan {r.plan_name}
                        {r.emailed_at ? " · enviado por mail" : " · sin mail"}
                      </p>
                    </div>
                    <button
                      disabled={resendBusy === r.id}
                      onClick={() => resendReceipt(expandedRow.vendor_id, r)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    >
                      {resendBusy === r.id ? "..." : "Reenviar"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: confirmar aprobación */}
      {approveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="font-display font-semibold">Aprobar el pago</h3>
            <p className="text-sm text-muted-foreground">
              {approveTarget.store_name} · {approveTarget.plan_name} · {money(approveTarget.amount)}
            </p>
            <div className="rounded-xl bg-muted p-3 text-xs space-y-1">
              <p>• El plan queda <b>activo</b> hasta el {fmt(approveTarget.plan_expires_at)}</p>
              <p>• Se emite el <b>Recibo X</b> (documento no válido como factura) y se manda por mail al dueño</p>
              <p>• Queda registrado quién y cuándo lo aprobó</p>
              {approveTarget.amount_mismatch && (
                <p className="text-amber-700 dark:text-amber-300">
                  ⚠ El plan hoy sale {money(approveTarget.expected_amount)} y el comercio declaró {money(approveTarget.amount)}. Revisá el comprobante antes de aprobar.
                </p>
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setApproveTarget(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button
                disabled={reviewBusy === approveTarget.id}
                onClick={() => approve(approveTarget)}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {reviewBusy === approveTarget.id ? "..." : "Aprobar y emitir recibo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: rechazo con motivos */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="font-display font-semibold">Rechazar el pago</h3>
            <p className="text-sm text-muted-foreground">
              {rejectTarget.item.store_name} · {money(rejectTarget.item.amount)}. El motivo se le envía al comercio.
            </p>
            <div className="space-y-1">
              {REJECT_PRESETS.map((preset) => (
                <label key={preset} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="reject-preset"
                    checked={rejectTarget.preset === preset}
                    onChange={() => setRejectTarget({ ...rejectTarget, preset })}
                  />
                  {preset}
                </label>
              ))}
            </div>
            <textarea
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              placeholder="Detalle adicional (opcional)"
              value={rejectTarget.extra}
              onChange={(e) => setRejectTarget({ ...rejectTarget, extra: e.target.value })}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRejectTarget(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button
                disabled={reviewBusy === rejectTarget.item.id}
                onClick={() => reject(rejectTarget.item, rejectTarget.preset, rejectTarget.extra)}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {reviewBusy === rejectTarget.item.id ? "..." : "Rechazar y avisar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: emitir recibo a mano */}
      {emitRow && emitForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 space-y-3">
            <h3 className="font-display font-semibold">Emitir recibo — {emitRow.store_name}</h3>
            <p className="text-xs text-muted-foreground">
              Para pagos por transferencia o en efectivo recibidos por fuera de la app. Queda registrado como pago aprobado.
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Plan</span>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={emitForm.planId}
                  onChange={(e) => {
                    const plan = plans.find((p) => p.id === e.target.value);
                    const price = plan ? planPriceFor(plan as any) : null;
                    setEmitForm({
                      ...emitForm,
                      planId: e.target.value,
                      amount: String(price?.amount ?? plan?.price_monthly ?? ""),
                      promoPct: price?.isPromo ? price.offPct ?? null : null,
                      promoListPrice: price?.isPromo ? price.listPrice : null,
                    });
                  }}
                >
                  {plans.filter((p) => p.slug !== "gratuito").map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {formatPrice(p.price_monthly)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">
                  Monto {emitForm.promoListPrice ? `(hoy sale ${formatPrice(Number(emitForm.amount))} · lista ${formatPrice(emitForm.promoListPrice)})` : "(precio de lista)"}
                </span>
                <input
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={emitForm.amount}
                  onChange={(e) => setEmitForm({ ...emitForm, amount: e.target.value })}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Desde</span>
                <input
                  type="date"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={emitForm.periodStart}
                  onChange={(e) => setEmitForm({ ...emitForm, periodStart: e.target.value })}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Hasta</span>
                <input
                  type="date"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={emitForm.periodEnd}
                  onChange={(e) => setEmitForm({ ...emitForm, periodEnd: e.target.value })}
                />
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Medio de pago</span>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={emitForm.method}
                  onChange={(e) => setEmitForm({ ...emitForm, method: e.target.value as any })}
                >
                  <option value="transferencia">Transferencia</option>
                  <option value="efectivo">Efectivo</option>
                </select>
              </label>
              <label className="text-xs space-y-1">
                <span className="text-muted-foreground">Nota interna</span>
                <input
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={emitForm.note}
                  onChange={(e) => setEmitForm({ ...emitForm, note: e.target.value })}
                  placeholder="Ej. pagó en el local"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={emitForm.renew} onChange={(e) => setEmitForm({ ...emitForm, renew: e.target.checked })} />
              Renovar el plan con este pago (activo hasta la fecha "Hasta")
            </label>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setEmitRow(null); setEmitForm(null); }} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Cancelar</button>
              <button
                disabled={emitBusy}
                onClick={submitEmit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {emitBusy ? "..." : "Emitir recibo"}
              </button>
            </div>
          </div>
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
