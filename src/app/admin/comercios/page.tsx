"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import DataTable, { Column } from "@/components/admin/data-table";
import VendorEditModal from "@/components/admin/vendor-edit-modal";
import DeleteConfirmModal from "@/components/admin/delete-confirm-modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VERTICALS } from "@/lib/config";
import { Pencil, Trash2, ExternalLink } from "lucide-react";

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
  logo_url: string | null;
  created_at: string;
};

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "bg-orange-100 text-orange-700",
  comercio: "bg-emerald-100 text-emerald-700",
  servicio: "bg-sky-100 text-sky-700",
  moda: "bg-violet-100 text-violet-700",
  salud: "bg-pink-100 text-pink-700",
  varios: "bg-amber-100 text-amber-700",
  mascotas: "bg-teal-100 text-teal-700",
};

export default function AdminComerciosPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [deleteVendor, setDeleteVendor] = useState<Vendor | null>(null);
  const [filterVertical, setFilterVertical] = useState("");
  const [filterVerified, setFilterVerified] = useState("");

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
            <p className="font-medium text-sm">{v.store_name}</p>
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
      key: "verified",
      label: "Estado",
      render: (v) => (
        <div className="flex items-center gap-1">
          {v.verified && <span className="text-[10px] text-blue-600 font-medium">&#10003; Verificado</span>}
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
        <span className="text-sm text-muted-foreground">{vendors.length} comercios</span>
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
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={vendors}
          searchPlaceholder="Buscar comercio..."
          searchKeys={["store_name", "slug", "neighborhood"]}
          pageSize={10}
          emptyMessage="No hay comercios"
          actions={(v) => (
            <div className="flex items-center gap-1 justify-end">
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
