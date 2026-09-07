"use client";

import { useEffect, useState, useCallback } from "react";
import DataTable, { Column } from "@/components/admin/data-table";
import SubscriptionModal, { SuscripcionRow } from "@/components/admin/subscription-modal";
import { VERTICALS } from "@/lib/config";
import { RefreshCw, Ban, ArrowLeftRight, Wallet } from "lucide-react";

type PlanOption = { id: string; slug: string; name: string; price_monthly: number };

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "bg-orange-100 text-orange-700",
  comercio: "bg-emerald-100 text-emerald-700",
  servicio: "bg-sky-100 text-sky-700",
  moda: "bg-violet-100 text-violet-700",
  salud: "bg-pink-100 text-pink-700",
};

function fmt(date: string | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toLocaleString("es-AR")}` : "-";
}

export default function AdminSuscripcionesPage() {
  const [rows, setRows] = useState<SuscripcionRow[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterVertical, setFilterVertical] = useState("");
  const [filterEstado, setFilterEstado] = useState("");
  const [modal, setModal] = useState<{ mode: "set_plan" | "extend" | "pay"; row: SuscripcionRow } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/suscripciones");
      const data = await res.json();
      if (!data.error) {
        setRows(data.subscriptions || []);
        setPlans(data.plans || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleSubmit(mode: "set_plan" | "extend" | "pay", payload: Record<string, unknown>) {
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
    fetchData();
  }

  async function handleCancel(row: SuscripcionRow) {
    if (!confirm(`¿Cancelar el plan de "${row.store_name}"?`)) return;
    const res = await fetch("/api/admin/suscripciones", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: row.vendor_id, action: "cancel" }),
    });
    const data = await res.json();
    if (res.ok && data.ok) fetchData();
  }

  const filtered = rows.filter((r) => {
    if (filterVertical && r.vertical !== filterVertical) return false;
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
        <div>
          <p className="font-medium text-sm">{r.store_name}</p>
          <p className="text-xs text-muted-foreground">{r.slug || "-"}</p>
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
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${r.plan_slug === "gratuito" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
            {r.plan_name}
          </span>
        </div>
      ),
    },
    {
      key: "effective_status",
      label: "Estado",
      render: (r) => {
        const m =
          r.effective_status === "trial" ? { label: "Prueba", cls: "bg-amber-100 text-amber-700" } :
          r.effective_status === "active" ? { label: "Activo", cls: "bg-green-100 text-green-700" } :
          r.effective_status === "expired" ? { label: "Vencido", cls: "bg-red-100 text-red-700" } :
          r.effective_status === "cancelled" ? { label: "Cancelado", cls: "bg-gray-100 text-gray-600" } :
          { label: "Gratuito", cls: "bg-muted text-muted-foreground" };
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
      render: (r) => (
        <span className="text-xs">
          {r.payment_method === "efectivo" ? "Efectivo" : r.payment_method === "transferencia" ? "Transferencia" : r.payment_method === "mercadopago" ? "Mercado Pago" : "-"}
        </span>
      ),
    },
  ];

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
                onClick={() => setModal({ mode: "set_plan", row: r })}
                className="p-1.5 rounded-md hover:bg-muted transition-colors"
                title="Cambiar plan"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              {r.plan_slug !== "gratuito" && (r.effective_status === "active" || r.effective_status === "trial") && (
                <>
                  {!r.paid && (
                    <button
                      onClick={() => setModal({ mode: "pay", row: r })}
                      className="p-1.5 rounded-md hover:bg-green-50 transition-colors"
                      title="Registrar pago"
                    >
                      <Wallet className="h-3.5 w-3.5 text-green-600" />
                    </button>
                  )}
                  <button
                    onClick={() => setModal({ mode: "extend", row: r })}
                    className="p-1.5 rounded-md hover:bg-muted transition-colors"
                    title="Renovar / extender"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </>
              )}
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

      <SubscriptionModal
        open={!!modal}
        onClose={() => setModal(null)}
        mode={modal?.mode || "set_plan"}
        row={modal?.row || null}
        plans={plans}
        onSubmit={handleSubmit}
      />
    </div>
  );
}