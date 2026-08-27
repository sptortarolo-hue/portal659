"use client";

import { useEffect, useState, useCallback } from "react";
import DataTable, { Column } from "@/components/admin/data-table";
import { ArrowRight } from "lucide-react";

type AuditLog = {
  id: string;
  order_id: string;
  old_status: string;
  new_status: string;
  changed_by: string;
  created_at: string;
  orders?: {
    total: number;
    customer_name: string;
    vendors?: { store_name: string } | null;
  } | null;
};

const STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  sent: "Enviado",
  completed: "Entregado",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  confirmed: "bg-amber-100 text-amber-700",
  preparing: "bg-orange-100 text-orange-700",
  ready: "bg-purple-100 text-purple-700",
  sent: "bg-cyan-100 text-cyan-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function AdminAuditoriaPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`/api/admin/audit?${params}`);
      const data = await res.json();
      if (!data.error) setLogs(data.logs);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, filterStatus]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const columns: Column<AuditLog>[] = [
    {
      key: "created_at",
      label: "Fecha",
      sortable: true,
      render: (l) => (
        <span className="text-xs">
          {new Date(l.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      ),
    },
    {
      key: "orders",
      label: "Pedido",
      render: (l) => (
        <div>
          <p className="text-sm font-medium">{l.orders?.vendors?.store_name || "-"}</p>
          <p className="text-xs text-muted-foreground">${Number(l.orders?.total || 0).toLocaleString("es-AR")}</p>
        </div>
      ),
    },
    {
      key: "old_status",
      label: "Cambio",
      render: (l) => (
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[l.old_status] || "bg-muted"}`}>
            {STATUS_LABELS[l.old_status] || l.old_status}
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[l.new_status] || "bg-muted"}`}>
            {STATUS_LABELS[l.new_status] || l.new_status}
          </span>
        </div>
      ),
    },
    {
      key: "changed_by",
      label: "Cambiado por",
      render: (l) => <span className="text-xs text-muted-foreground">{l.changed_by || "Sistema"}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Auditoría</h1>
        <span className="text-sm text-muted-foreground">{logs.length} registros</span>
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Desde</label>
          <input
            type="date"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Hasta</label>
          <input
            type="date"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Estado</label>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={logs}
          pageSize={20}
          emptyMessage="No hay registros de auditoría"
        />
      )}
    </div>
  );
}
