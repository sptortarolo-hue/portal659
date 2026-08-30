"use client";

import { useEffect, useState } from "react";
import type { Order, Product, Review } from "@/types/database";

type OrderItem = { name: string; price: number; qty: number };

type AnalyticsSummary = {
  activeOrders: number;
  newOrders: number;
  preparingOrders: number;
  readyOrders: number;
  sentOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
  avgOrderValue: number;
  totalProducts: number;
  availableProducts: number;
  totalReviews: number;
  avgRating: number | null;
};

type TopProduct = { name: string; count: number; revenue: number };
type OrdersByDay = { date: string; count: number; revenue: number };

type AnalyticsData = {
  summary: AnalyticsSummary;
  topProducts: TopProduct[];
  ordersByDay: OrdersByDay[];
  recentReviews: Review[];
  lowStock: Product[];
  activeOrders: (Order & { items: OrderItem[] })[];
};

export function VendorAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vendor/analytics")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground text-sm">Cargando estadísticas...</p>;
  if (!data) return <p className="text-muted-foreground text-sm">No se pudieron cargar las estadísticas.</p>;

  const { summary, topProducts, ordersByDay, recentReviews, lowStock, activeOrders } = data;

  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl font-semibold">Estadísticas</h2>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Nuevos", value: summary.newOrders || 0, color: "text-blue-600" },
          { label: "Preparando", value: summary.preparingOrders || 0, color: "text-orange-600" },
          { label: "Listos", value: summary.readyOrders || 0, color: "text-green-600" },
          { label: "Enviados", value: summary.sentOrders || 0, color: "text-purple-600" },
          { label: "Facturación", value: `$${summary.totalRevenue.toLocaleString("es-AR")}`, color: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-xl p-3 bg-card text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Productos", value: summary.availableProducts, sub: `de ${summary.totalProducts}` },
          { label: "Reseñas", value: summary.totalReviews, sub: `⭐ ${summary.avgRating}` },
          { label: "Cancelados", value: summary.cancelledOrders, sub: "" },
          { label: "Stock bajo", value: lowStock.length, sub: lowStock.length > 0 ? "⚠️" : "✓" },
        ].map((s) => (
          <div key={s.label} className="border border-border rounded-xl p-3 bg-card text-center">
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{s.label} {s.sub}</p>
          </div>
        ))}
      </div>

      {activeOrders.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2">Pedidos pendientes</h3>
          <div className="space-y-2">
            {activeOrders.map((o) => (
              <div key={o.id} className="border border-border rounded-lg p-3 bg-card text-sm">
                <div className="flex justify-between">
                  <span>{(o.items || []).map((i) => `${i.qty}x ${i.name}`).join(", ")}</span>
                  <span className="font-medium">${Number(o.total).toLocaleString("es-AR")}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {o.status === "new" ? "🆕 Nuevo" : o.status === "preparing" ? "🍳 Preparando" : "📦 Listo"} · {new Date(o.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {topProducts.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2">Top productos por facturación</h3>
          <div className="space-y-1">
            {topProducts.map((p, i) => (
              <div key={i} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                <span className="text-muted-foreground">{p.name}</span>
                <span className="font-medium">{p.count} vendidos · ${p.revenue.toLocaleString("es-AR")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ordersByDay.some((d) => d.count > 0) && (
        <div>
          <h3 className="font-medium text-sm mb-2">Pedidos últimos 30 días</h3>
          <div className="flex items-end gap-px h-20">
            {ordersByDay.map((d) => {
              const maxCount = Math.max(...ordersByDay.map((x) => x.count), 1);
              const height = d.count > 0 ? Math.max((d.count / maxCount) * 100, 8) : 2;
              return (
                <div
                  key={d.date}
                  className="flex-1 bg-primary/80 rounded-t min-w-[2px]"
                  style={{ height: `${height}%` }}
                  title={`${d.date}: ${d.count} pedidos ($${d.revenue.toLocaleString("es-AR")})`}
                />
              );
            })}
          </div>
        </div>
      )}

      {recentReviews.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2">Últimas reseñas</h3>
          <div className="space-y-2">
            {recentReviews.map((r, i) => (
              <div key={i} className="text-sm">
                <span>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span>
                <span className="ml-2 font-medium">{r.customer_name}</span>
                {r.comment && <span className="text-muted-foreground ml-2">— {r.comment}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {lowStock.length > 0 && (
        <div>
          <h3 className="font-medium text-sm mb-2 text-amber-600">⚠️ Stock bajo</h3>
          <div className="space-y-1">
            {lowStock.map((p) => (
              <div key={p.id} className="flex justify-between text-sm py-1">
                <span>{p.name}</span>
                <span className="text-amber-600 font-medium">{p.stock} unidades</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
