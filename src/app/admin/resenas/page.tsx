"use client";

import { useEffect, useState, useCallback } from "react";
import DataTable, { Column } from "@/components/admin/data-table";
import DeleteConfirmModal from "@/components/admin/delete-confirm-modal";
import { Trash2, Star, Flag, ShieldCheck, RotateCcw } from "lucide-react";

type Review = {
  id: string;
  rating: number;
  customer_name: string;
  comment: string;
  created_at: string;
  reported: boolean;
  reported_at: string | null;
  report_reason: string | null;
  moderated: boolean;
  moderated_at: string | null;
  moderated_by: string | null;
  vendors?: { store_name: string; slug: string } | null;
};

export default function AdminResenasPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteReview, setDeleteReview] = useState<Review | null>(null);
  const [filterRating, setFilterRating] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "reported" | "moderated">("");

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterRating) params.set("rating", filterRating);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`/api/admin/reviews?${params}`);
      const data = await res.json();
      if (!data.error) setReviews(data.reviews);
    } finally {
      setLoading(false);
    }
  }, [filterRating, filterStatus]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  async function handleDelete() {
    if (!deleteReview) return;
    await fetch("/api/admin/reviews", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: deleteReview.id }),
    });
    setDeleteReview(null);
    fetchReviews();
  }

  async function handleModerate(id: string, action: "moderate" | "restore") {
    await fetch(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    fetchReviews();
  }

  const columns: Column<Review>[] = [
    {
      key: "rating",
      label: "Estrellas",
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((s) => (
            <Star key={s} className={`h-3.5 w-3.5 ${s <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
          ))}
        </div>
      ),
    },
    {
      key: "customer_name",
      label: "Cliente",
      sortable: true,
      render: (r) => <span className="text-sm font-medium">{r.customer_name}</span>,
    },
    {
      key: "vendors",
      label: "Comercio",
      render: (r) => <span className="text-sm">{r.vendors?.store_name || "-"}</span>,
    },
    {
      key: "comment",
      label: "Comentario",
      render: (r) => <span className="text-sm text-muted-foreground line-clamp-2">{r.comment || "Sin comentario"}</span>,
    },
    {
      key: "report_reason",
      label: "Reporte",
      render: (r) => r.reported ? (
        <div className="text-xs">
          <div className="flex items-center gap-1 text-orange-600 font-medium">
            <Flag className="h-3 w-3" />
            Reportada
          </div>
          {r.report_reason && <span className="text-muted-foreground line-clamp-1">{r.report_reason}</span>}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">-</span>
      ),
    },
    {
      key: "moderated",
      label: "Moderada",
      render: (r) => r.moderated ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
          <ShieldCheck className="h-3.5 w-3.5" />
          Sí
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">No</span>
      ),
    },
    {
      key: "created_at",
      label: "Fecha",
      sortable: true,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Reseñas</h1>
        <span className="text-sm text-muted-foreground">{reviews.length} reseñas</span>
      </div>

      <div className="flex gap-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filterRating}
          onChange={(e) => setFilterRating(e.target.value)}
        >
          <option value="">Todas las estrellas</option>
          <option value="5">5 estrellas</option>
          <option value="4">4 estrellas</option>
          <option value="3">3 estrellas</option>
          <option value="2">2 estrellas</option>
          <option value="1">1 estrella</option>
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as "" | "reported" | "moderated")}
        >
          <option value="">Todas</option>
          <option value="reported">Reportadas</option>
          <option value="moderated">Moderadas</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={reviews}
          searchPlaceholder="Buscar reseña..."
          searchKeys={["customer_name", "comment", "report_reason"]}
          pageSize={15}
          emptyMessage="No hay reseñas"
          actions={(r) => (
            <div className="flex items-center gap-1">
              {r.reported && !r.moderated && (
                <button
                  onClick={() => handleModerate(r.id, "moderate")}
                  className="p-1.5 rounded-md hover:bg-orange-50 transition-colors"
                  title="Marcar como moderada"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-orange-500" />
                </button>
              )}
              {r.moderated && (
                <button
                  onClick={() => handleModerate(r.id, "restore")}
                  className="p-1.5 rounded-md hover:bg-blue-50 transition-colors"
                  title="Restaurar reseña"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-blue-500" />
                </button>
              )}
              <button onClick={() => setDeleteReview(r)} className="p-1.5 rounded-md hover:bg-red-50 transition-colors">
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </button>
            </div>
          )}
        />
      )}

      <DeleteConfirmModal
        open={!!deleteReview}
        onClose={() => setDeleteReview(null)}
        onConfirm={handleDelete}
        title="Eliminar reseña"
        message="¿Eliminar esta reseña? Esta acción no se puede deshacer."
      />
    </div>
  );
}