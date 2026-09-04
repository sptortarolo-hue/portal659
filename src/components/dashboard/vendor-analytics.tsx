"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Product, Review } from "@/types/database";

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
  plan: { slug: string; analyticsDays: number; eligibleForPaid?: boolean };
  today: { orders: number; revenue: number; avgOrderValue: number };
  comparison?: { revenueDelta: number | null; ordersDelta: number | null };
  insights?: string[];
  summary?: AnalyticsSummary;
  topProducts?: TopProduct[];
  ordersByDay?: OrdersByDay[];
  recentReviews?: Review[];
  lowStock?: Product[];
  activeOrders?: (Record<string, any> & { items: OrderItem[] })[];
  byChannel?: Record<string, number>;
  byMethod?: Record<string, number>;
  topHours?: { hour: string; count: number }[];
  customers?: { new: number; recurring: number; withAccount: number };
  byCategory?: { category: string; count: number; revenue: number }[];
};

const CHANNEL_LABEL: Record<string, string> = { app: "App / WhatsApp", mostrador: "Mostrador", mesa: "Mesas" };
const METHOD_LABEL: Record<string, string> = { pickup: "Retiro", delivery: "Domicilio" };

function StatCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="border border-border rounded-xl p-3 bg-card text-center">
      <p className={`text-xl font-bold ${color || ""}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label} {sub ? `· ${sub}` : ""}</p>
    </div>
  );
}

function DeltaBadge({ value, prefix }: { value: number | null; prefix: string }) {
  if (value == null) return <span className="text-xs text-muted-foreground">sin datos previos</span>;
  const up = value >= 0;
  return (
    <span className={`text-xs font-semibold ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {prefix} {Math.abs(value)}% {up ? "vs" : "vs"} semana anterior
    </span>
  );
}

function TodayPanel({ today }: { today: AnalyticsData["today"] }) {
  return (
    <div>
      <h3 className="font-medium text-sm text-muted-foreground mb-2">Hoy</h3>
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pedidos" value={today.orders || 0} />
        <StatCard label="Ventas" value={`$${Number(today.revenue).toLocaleString("es-AR")}`} />
        <StatCard label="Ticket prom." value={`$${Number(today.avgOrderValue).toLocaleString("es-AR")}`} />
      </div>
    </div>
  );
}

export function VendorAnalytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    fetch("/api/vendor/analytics")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        // Solo aceptamos la respuesta si es exitosa y trae la estructura esperada
        // (un 401/403 con { error } NO son datos válidos: rompían el render y
        // dejaban el dashboard "tildado" por un TypeError en el cliente).
        if (r.ok && d && d.today) setData(d);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  if (loading) return <p className="text-muted-foreground text-sm">Cargando estadísticas...</p>;
  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">No se pudieron cargar las estadísticas. Revisá tu conexión.</p>
        <button onClick={load} className="text-sm font-medium text-primary underline">Reintentar</button>
      </div>
    );
  }

  const analyticsDays = data.plan?.analyticsDays ?? 0;
  const isPaid = analyticsDays > 0;
  const isGest = analyticsDays >= 99999;
  const periodLabel = isGest ? "periodo" : `últimos ${analyticsDays} días`;

  const { summary = {} as AnalyticsSummary, topProducts = [], ordersByDay = [], recentReviews = [], lowStock = [], activeOrders = [] } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Estadísticas</h2>
        <span className="text-xs text-muted-foreground">{periodLabel}</span>
      </div>

      {/* Panel de hoy: visible para todos los planes */}
      <TodayPanel today={data.today} />

      {/* Gratuito: solo el panel de hoy + CTA */}
      {!isPaid && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            Subí de plan para ver ventas, ticket promedio, tus productos más vendidos y más.
          </p>
          <Link
            href="/vendor/suscripcion"
            className="inline-block rounded-full bg-primary text-primary-foreground px-6 py-2.5 text-sm font-semibold hover:bg-primary/90"
          >
            Ver planes y estadísticas
          </Link>
        </div>
      )}

      {/* Planes pagos: resumen + detalle */}
      {isPaid && (
        <>
          {/* Comparativo semanal */}
          {data.comparison && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-medium text-sm mb-2">Comparativa semanal</h3>
              <div className="flex flex-wrap gap-4">
                <DeltaBadge value={data.comparison.revenueDelta} prefix="ventas" />
                <DeltaBadge value={data.comparison.ordersDelta} prefix="pedidos" />
              </div>
            </div>
          )}

          {/* Insights */}
          {data.insights && data.insights.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <h3 className="font-medium text-sm mb-2">💡 Para tu negocio</h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {data.insights.map((i, idx) => (
                  <li key={idx}>• {i}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Nuevos" value={summary.newOrders || 0} color="text-blue-600" />
            <StatCard label="Preparando" value={summary.preparingOrders || 0} color="text-orange-600" />
            <StatCard label="Listos" value={summary.readyOrders || 0} color="text-green-600" />
            <StatCard label="Enviados" value={summary.sentOrders || 0} color="text-purple-600" />
            <StatCard label="Facturación" value={`$${(summary.totalRevenue || 0).toLocaleString("es-AR")}`} color="text-primary" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Ticket promedio" value={`$${(summary.avgOrderValue || 0).toLocaleString("es-AR")}`} />
            <StatCard label="Reseñas" value={summary.totalReviews || 0} sub={`⭐ ${summary.avgRating ?? "—"}`} />
            <StatCard label="Cancelados" value={summary.cancelledOrders || 0} />
            <StatCard label="Stock bajo" value={lowStock.length} sub={lowStock.length > 0 ? "⚠️" : "✓"} />
          </div>

          {activeOrders.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Pedidos pendientes</h3>
              <div className="space-y-2">
                {activeOrders.map((o) => (
                  <div key={o.id} className="border border-border rounded-lg p-3 bg-card text-sm">
                    <div className="flex justify-between">
                      <span>{(o.items || []).map((i: any) => `${i.qty}x ${i.name}`).join(", ")}</span>
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

          {/* Canal y método */}
          {data.byChannel && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="border border-border rounded-xl p-4 bg-card">
                <h3 className="font-medium text-sm mb-3">Pedidos por canal</h3>
                <div className="space-y-2">
                  {Object.entries(data.byChannel).map(([c, count]) => (
                    <div key={c} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{CHANNEL_LABEL[c] || c}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border border-border rounded-xl p-4 bg-card">
                <h3 className="font-medium text-sm mb-3">Retiro vs domicilio</h3>
                <div className="space-y-2">
                  {Object.entries(data.byMethod || {}).map(([m, count]) => (
                    <div key={m} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{METHOD_LABEL[m] || m}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
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
              <h3 className="font-medium text-sm mb-2">Pedidos {periodLabel}</h3>
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

          {/* Avanzado - Gestión */}
          {isGest && (
            <>
              {data.topHours && data.topHours.length > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2">Horarios pico</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {data.topHours.map((h) => (
                      <div key={h.hour} className="border border-border rounded-xl p-3 bg-card text-center">
                        <p className="text-lg font-bold">{h.hour}:00</p>
                        <p className="text-[10px] text-muted-foreground">{h.count} pedidos</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.customers && data.customers.withAccount > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2">Clientes</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <StatCard label="Recurrentes" value={data.customers.recurring} />
                    <StatCard label="Nuevos" value={data.customers.new} />
                    <StatCard label="Con cuenta" value={data.customers.withAccount} />
                  </div>
                </div>
              )}

              {data.byCategory && data.byCategory.length > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2">Ventas por categoría</h3>
                  <div className="space-y-1">
                    {data.byCategory.map((c) => (
                      <div key={c.category} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                        <span className="text-muted-foreground">{c.category}</span>
                        <span className="font-medium">{c.count} un. · ${c.revenue.toLocaleString("es-AR")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
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
        </>
      )}
    </div>
  );
}