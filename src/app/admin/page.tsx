"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGuard from "@/components/admin/admin-guard";
import type { Vendor as DBVendor, Order as DBOrder, Review as DBReview } from "@/types/database";

type VendorData = DBVendor & { is_admin?: boolean };
type OrderData = DBOrder & { vendors?: { store_name: string } | null };
type ReviewData = DBReview & { vendors?: { store_name: string } | null };

type AdminStats = {
  totalVendors: number;
  totalOrders: number;
  totalProducts: number;
  totalReviews: number;
  totalRevenue: number;
  avgRating: number | null;
};

type AdminData = {
  vendors: VendorData[];
  orders: OrderData[];
  reviews: ReviewData[];
  stats: AdminStats;
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

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  new: { label: "Nuevo", color: "bg-blue-100 text-blue-700" },
  confirmed: { label: "Confirmado", color: "bg-amber-100 text-amber-700" },
  completed: { label: "Entregado", color: "bg-green-100 text-green-700" },
  cancelled: { label: "Cancelado", color: "bg-red-100 text-red-700" },
};

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "vendors" | "orders" | "reviews">("overview");

  useEffect(() => {
    fetch("/api/admin")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
        setLoading(false);
      })
      .catch(() => { setError("Error al cargar datos"); setLoading(false); });
  }, []);

  async function handleAction(vendorId: string, action: string) {
    await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, action }),
    });
    const res = await fetch("/api/admin");
    const d = await res.json();
    if (!d.error) setData(d);
  }

  if (loading) return <main className="container mx-auto px-4 py-8 max-w-6xl"><p className="text-muted-foreground">Cargando panel admin...</p></main>;
  if (error) return <main className="container mx-auto px-4 py-8 max-w-6xl"><p className="text-red-600">{error}</p></main>;
  if (!data) return null;

  const { vendors, orders, reviews, stats } = data;

  return (
    <AdminGuard>
    <main className="container mx-auto px-4 py-8 max-w-6xl">
      <h1 className="font-display text-3xl font-semibold mb-6">Panel Admin — Portal 659</h1>

      <nav className="flex gap-2 mb-8 border-b border-border pb-2 overflow-x-auto">
        {(["overview", "vendors", "orders", "reviews"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap ${
              tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {t === "overview" ? "Resumen" : t === "vendors" ? `Comercios (${vendors.length})` : t === "orders" ? `Pedidos (${orders.length})` : `Reseñas (${reviews.length})`}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: "Comercios", value: stats.totalVendors, color: "text-primary" },
            { label: "Pedidos", value: stats.totalOrders, color: "text-blue-600" },
            { label: "Productos", value: stats.totalProducts, color: "text-emerald-600" },
            { label: "Reseñas", value: stats.totalReviews, color: "text-amber-600" },
            { label: "Facturación", value: `$${stats.totalRevenue.toLocaleString("es-AR")}`, color: "text-green-600" },
            { label: "Rating prom.", value: stats.avgRating || "—", color: "text-violet-600" },
          ].map((s) => (
            <div key={s.label} className="border border-border rounded-xl p-4 bg-card text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "vendors" && (
        <div className="space-y-3">
          {vendors.map((v: VendorData) => (
            <div key={v.id} className="border border-border rounded-xl p-4 bg-card flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {v.logo_url ? (
                  <img src={v.logo_url} alt="" className="h-10 w-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="font-bold text-primary/60 text-sm">{v.store_name?.charAt(0)}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/tienda/${v.slug}`} className="font-medium text-sm hover:underline truncate">{v.store_name}</Link>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${VERTICAL_COLORS[v.vertical] || "bg-muted text-muted-foreground"}`}>
                      {v.vertical}
                    </span>
                    {v.verified && <span className="text-[10px] text-blue-600">✓ Verificado</span>}
                    {v.is_admin && <span className="text-[10px] text-amber-600">Admin</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{v.slug} · {v.neighborhood || "Sin barrio"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleAction(v.id, "toggle_verified")}
                  className={`text-xs px-2.5 py-1 rounded-md border ${v.verified ? "border-blue-300 bg-blue-50 text-blue-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  {v.verified ? "Verificado" : "Verificar"}
                </button>
                <button
                  onClick={() => handleAction(v.id, "toggle_admin")}
                  className={`text-xs px-2.5 py-1 rounded-md border ${v.is_admin ? "border-amber-300 bg-amber-50 text-amber-700" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  {v.is_admin ? "Admin" : "Hacer admin"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "orders" && (
        <div className="space-y-3">
          {orders.length === 0 && <p className="text-muted-foreground text-center py-8">No hay pedidos todavía.</p>}
          {orders.map((o: OrderData) => {
            const st = ORDER_STATUS[o.status] || ORDER_STATUS.new;
            return (
              <div key={o.id} className="border border-border rounded-xl p-4 bg-card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-sm">{o.vendors?.store_name || "Local"}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {new Date(o.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                    <span className="font-bold text-sm">${Number(o.total).toLocaleString("es-AR")}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {(o.items || []).map((i: { name: string; price: number; qty: number }, idx: number) => (
                    <span key={idx}>{i.qty}x {i.name}{idx < o.items.length - 1 ? " · " : ""}</span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{o.customer_name} · {o.customer_phone}</p>
              </div>
            );
          })}
        </div>
      )}

      {tab === "reviews" && (
        <div className="space-y-3">
          {reviews.length === 0 && <p className="text-muted-foreground text-center py-8">No hay reseñas todavía.</p>}
          {reviews.map((r: ReviewData) => (
            <div key={r.id} className="border border-border rounded-xl p-4 bg-card">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                <span className="font-medium text-sm">{r.customer_name}</span>
                <span className="text-xs text-muted-foreground">en {r.vendors?.store_name}</span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(r.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                </span>
              </div>
              {r.comment && <p className="text-sm text-muted-foreground mt-1">{r.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </main>
    </AdminGuard>
  );
}
