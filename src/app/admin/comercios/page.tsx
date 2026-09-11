"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import DataTable, { Column } from "@/components/admin/data-table";
import VendorEditModal from "@/components/admin/vendor-edit-modal";
import VendorCreateModal from "@/components/admin/vendor-create-modal";
import DeleteConfirmModal from "@/components/admin/delete-confirm-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VERTICALS } from "@/lib/config";
import { Pencil, Trash2, ExternalLink, Plus } from "lucide-react";

type Vendor = {
  id: string;
  store_name: string;
  slug: string;
  description: string;
  vertical: string;
  neighborhood: string;
  phone: string;
  whatsapp: string;
  address: string;
  verified: boolean;
  is_admin: boolean;
  visible: boolean;
  logo_url: string | null;
  created_at: string;
  plan_id: string | null;
  plan_status: string;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
  paid_at: string | null;
  payment_method: string | null;
  publish_requested_at: string | null;
};

type Plan = {
  id: string;
  slug: string;
  name: string;
  badge: string | null;
};

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "bg-orange-100 text-orange-700",
  comercio: "bg-emerald-100 text-emerald-700",
  servicio: "bg-sky-100 text-sky-700",
  moda: "bg-violet-100 text-violet-700",
  salud: "bg-pink-100 text-pink-700",
};

export default function AdminComerciosPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [deleteVendor, setDeleteVendor] = useState<Vendor | null>(null);
  const [filterVertical, setFilterVertical] = useState("");
  const [filterVerified, setFilterVerified] = useState("");
  const [filterPending, setFilterPending] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    fetch("/api/subscriptions/plans")
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .catch(() => setPlans([]));
  }, []);

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterVertical) params.set("vertical", filterVertical);
      if (filterVerified) params.set("verified", filterVerified);
      const res = await fetch(`/api/admin/comercios?${params}`);
      const data = await res.json();
      if (!data.error) setVendors(data.vendors);
    } finally {
      setLoading(false);
    }
  }, [filterVertical, filterVerified]);

  useEffect(() => { fetchVendors(); }, [fetchVendors]);

  async function handleToggleVerified(id: string) {
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: id, action: "toggle_verified" }),
    });
    fetchVendors();
  }

  async function handleToggleAdmin(id: string) {
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: id, action: "toggle_admin" }),
    });
    fetchVendors();
  }

  async function handleToggleVisible(id: string) {
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: id, action: "toggle_visible" }),
    });
    fetchVendors();
  }

  async function handleApprovePublish(id: string) {
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: id, action: "approve_publish" }),
    });
    fetchVendors();
  }

  async function handleRejectPublish(id: string) {
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: id, action: "clear_publish_request" }),
    });
    fetchVendors();
  }

  async function handleSetPlan(id: string, planSlug: string) {
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: id, action: "set_plan", planSlug, days: 30 }),
    });
    fetchVendors();
  }

  function planInfo(v: Vendor) {
    const plan = plans.find((p) => p.id === v.plan_id);
    const visible =
      v.plan_status === "trial" || v.plan_status === "active" || v.plan_status === "expired";
    return { plan: plan || plans.find((p) => p.slug === "gratuito"), visible, status: v.plan_status };
  }

  async function handleSaveVendor(data: Partial<Vendor>) {
    if (!editVendor) return;
    await fetch("/api/admin/comercios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: editVendor.id, action: "update", data }),
    });
    fetchVendors();
  }

  async function handleDeleteVendor() {
    if (!deleteVendor) return;
    await fetch("/api/admin/comercios", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: deleteVendor.id }),
    });
    setDeleteVendor(null);
    fetchVendors();
  }

  async function handleCreateVendor(data: Record<string, string>) {
    const res = await fetch("/api/admin/comercios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      return { error: json.error || "Error al crear el comercio" };
    }
    fetchVendors();
    return {};
  }

  const columns: Column<Vendor>[] = [
    {
      key: "store_name",
      label: "Comercio",
      sortable: true,
      render: (v) => (
        <div className="flex items-center gap-2">
          {v.logo_url ? (
            <img src={v.logo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
              <span className="text-xs font-bold text-muted-foreground">{v.store_name?.charAt(0)}</span>
            </div>
          )}
          <div>
            <Link href={`/admin/comercios/${v.id}`} className="font-medium text-sm hover:underline">
              {v.store_name}
            </Link>
            <p className="text-xs text-muted-foreground">{v.slug}</p>
          </div>
        </div>
      ),
    },
    {
      key: "vertical",
      label: "Vertical",
      sortable: true,
      render: (v) => (
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${VERTICAL_COLORS[v.vertical] || "bg-muted text-muted-foreground"}`}>
          {VERTICALS.find((vt) => vt.slug === v.vertical)?.name || v.vertical}
        </span>
      ),
    },
    {
      key: "neighborhood",
      label: "Barrio",
      sortable: true,
      render: (v) => <span className="text-sm">{v.neighborhood || "-"}</span>,
    },
    {
      key: "plan",
      label: "Plan",
      render: (v) => {
        const info = planInfo(v);
        const status =
          v.plan_status === "trial"
            ? { label: "Prueba", cls: "bg-sun/20 text-ink" }
            : v.plan_status === "active"
              ? { label: "Activo", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" }
              : v.plan_status === "expired"
                ? { label: "Vencido", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
                : null;
        const paidLabel =
          v.plan_status === "active" || v.plan_status === "trial"
            ? v.paid_at
              ? { label: "Pagado", cls: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" }
              : { label: "Sin pagar", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" }
            : null;
        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${v.plan_status === "gratuito" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                {info.plan?.name ?? "Gratuito"}
              </span>
              {status && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${status.cls}`}>{status.label}</span>}
              {paidLabel && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${paidLabel.cls}`}>{paidLabel.label}</span>}
            </div>
            {v.plan_expires_at && v.plan_status !== "gratuito" && (
              <span className="text-[10px] text-muted-foreground">
                Vence: {new Date(v.plan_expires_at).toLocaleDateString("es-AR")}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "verified",
      label: "Estado",
      render: (v) => (
        <div className="flex items-center gap-1">
          {v.visible ? (
            <span className="text-[10px] text-green-600 font-medium">&#9679; Visible</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">&#9679; Oculto</span>
          )}
          {v.verified && <span className="text-[10px] text-blue-600 font-medium">&#10003; Verificado</span>}
          {v.publish_requested_at && !v.visible && (
            <span className="text-[10px] text-violet-700 font-bold">📩 Solicita publicar</span>
          )}
          {v.is_admin && <span className="text-[10px] text-amber-600 font-medium">Admin</span>}
          {!v.verified && !v.is_admin && <span className="text-[10px] text-muted-foreground">Pendiente</span>}
        </div>
      ),
    },
    {
      key: "created_at",
      label: "Registro",
      sortable: true,
      render: (v) => (
        <span className="text-xs text-muted-foreground">
          {new Date(v.created_at).toLocaleDateString("es-AR")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Comercios</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{vendors.length} comercios</span>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo comercio
          </Button>
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
          value={filterVerified}
          onChange={(e) => setFilterVerified(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="true">Verificados</option>
          <option value="false">No verificados</option>
        </select>
        <button
          onClick={() => setFilterPending((v) => !v)}
          className={`h-9 rounded-md border px-3 text-sm transition-colors ${
            filterPending
              ? "border-violet-300 bg-violet-50 text-violet-700 font-semibold"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          📩 Pendientes ({vendors.filter((v) => v.publish_requested_at && !v.visible).length})
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filterPending ? vendors.filter((v) => v.publish_requested_at && !v.visible) : vendors}
          searchPlaceholder="Buscar comercio..."
          searchKeys={["store_name", "slug", "neighborhood"]}
          pageSize={10}
          emptyMessage="No hay comercios"
          actions={(v) => (
            <div className="flex items-center gap-1 justify-end">
              {v.publish_requested_at && !v.visible && (
                <>
                  <button
                    onClick={() => handleApprovePublish(v.id)}
                    className="text-xs px-2 py-1 rounded-md border border-green-300 bg-green-50 text-green-700 font-semibold"
                    title="Publicar comercio"
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => handleRejectPublish(v.id)}
                    className="text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted"
                    title="Rechazar solicitud"
                  >
                    Rechazar
                  </button>
                </>
              )}
              <button
                onClick={() => handleToggleVerified(v.id)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  v.verified ? "border-blue-300 bg-blue-50 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {v.verified ? "Verificado" : "Verificar"}
              </button>
              <button
                onClick={() => handleToggleAdmin(v.id)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  v.is_admin ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {v.is_admin ? "Admin" : "Admin"}
              </button>
              <button
                onClick={() => handleToggleVisible(v.id)}
                className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                  v.visible ? "border-green-300 bg-green-50 text-green-700" : "border-border text-muted-foreground hover:bg-muted"
                }`}
                title={v.visible ? "Ocultar de la página" : "Mostrar en la página"}
              >
                {v.visible ? "Visible" : "Oculto"}
              </button>
              <select
                value={v.plan_id ?? ""}
                onChange={(e) => handleSetPlan(v.id, e.target.value)}
                className="text-xs px-2 py-1 rounded-md border border-border bg-background text-muted-foreground"
                title="Cambiar plan (30 días)"
              >
                <option value="" disabled>Plan...</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.slug}>{p.name}</option>
                ))}
              </select>
              <button onClick={() => setEditVendor(v)} className="p-1.5 rounded-md hover:bg-muted transition-colors">
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <Link href={`/tienda/${v.slug}`} target="_blank" className="p-1.5 rounded-md hover:bg-muted transition-colors">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <button onClick={() => setDeleteVendor(v)} className="p-1.5 rounded-md hover:bg-red-50 transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </button>
            </div>
          )}
        />
      )}

      <VendorEditModal
        open={!!editVendor}
        vendor={editVendor}
        onClose={() => setEditVendor(null)}
        onSave={handleSaveVendor}
      />

      <VendorCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreateVendor}
      />

      <DeleteConfirmModal
        open={!!deleteVendor}
        onClose={() => setDeleteVendor(null)}
        onConfirm={handleDeleteVendor}
        title="Eliminar comercio"
        message={`¿Eliminar "${deleteVendor?.store_name}"? Esta acción no se puede deshacer.`}
      />
    </div>
  );
}
