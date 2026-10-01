"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { Product, Review } from "@/types/database";
import { CASH_METHOD_LABELS } from "@/lib/cash-methods";

const SalesEvolution = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.SalesEvolution })), {
  ssr: false,
  loading: () => <div className="h-64 rounded-xl border border-border bg-muted/40 animate-pulse" />,
});
const HourlyChart = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.HourlyChart })), {
  ssr: false,
  loading: () => <div className="h-56 rounded-xl border border-border bg-muted/40 animate-pulse" />,
});
const ShareDonut = dynamic(() => import("./analytics-charts").then((m) => ({ default: m.ShareDonut })), {
  ssr: false,
  loading: () => <div className="h-72 rounded-xl border border-border bg-muted/40 animate-pulse" />,
});

type OrderItem = { name: string; price: number; qty: number };

type AnalyticsSummary = {
  totalOrders?: number;
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
  plan: { slug: string; analyticsDays: number; range?: number; eligibleForPaid?: boolean };
  today: { orders: number; revenue: number; avgOrderValue: number };
  comparison?: { revenueDelta: number | null; ordersDelta: number | null };
  monthly?: { revenueDelta: number | null; ordersDelta: number | null; ticketDelta: number | null };
  insights?: string[];
  summary?: AnalyticsSummary;
  topProducts?: TopProduct[];
  ordersByDay?: OrdersByDay[];
  recentReviews?: Review[];
  lowStock?: Product[];
  activeOrders?: (Record<string, any> & { items: OrderItem[] })[];
  byChannel?: Record<string, { count: number; revenue: number }>;
  byMethod?: Record<string, { count: number; revenue: number }>;
  byPay?: Record<string, { count: number; revenue: number }>;
  discounts?: { cash: number; volume: number };
  hourly?: { hour: string; count: number; revenue: number }[];
  topHours?: { hour: string; count: number; revenue: number }[];
  byDayOfWeek?: { day: string; count: number; revenue: number }[];
  deadProducts?: { id: string; name: string; category: string }[];
  customers?: { new: number; recurring: number; withAccount: number };
  byCategory?: { category: string; count: number; revenue: number }[];
};

const CHANNEL_LABEL: Record<string, string> = { app: "App / WhatsApp", mostrador: "Mostrador", mesa: "Mesas" };
const METHOD_LABEL: Record<string, string> = { pickup: "Retiro", delivery: "Domicilio" };

function StatCard({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="border border-border rounded-xl p-3 bg-card text-center min-w-0">
      <p className={`text-lg sm:text-xl font-bold tabular-nums break-words ${color || ""}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label} {sub ? `· ${sub}` : ""}</p>
    </div>
  );
}

function DeltaBadge({ value, prefix, vs = "semana anterior" }: { value: number | null; prefix: string; vs?: string }) {
  if (value == null) return <span className="text-xs text-muted-foreground">sin datos previos</span>;
  const up = value >= 0;
  return (
    <span className={`text-xs font-semibold ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? "▲" : "▼"} {prefix} {Math.abs(value)}% {up ? "vs" : "vs"} {vs}
    </span>
  );
}

function toSlices(
  rec: Record<string, { count: number; revenue: number }> | undefined,
  labels?: Record<string, string>
) {
  return Object.entries(rec || {})
    .map(([k, d]) => ({ label: labels?.[k] || k, count: d.count, revenue: Math.round(d.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
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
  const [range, setRange] = useState(30);

  const load = () => {
    setLoading(true);
    setError(false);
    fetch(`/api/vendor/analytics?range=${range}`)
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
  useEffect(load, [range]);

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
  const activeRange = data.plan?.range ?? 30;
  const periodLabel = isGest ? `últimos ${activeRange} días` : `últimos ${analyticsDays} días`;

  const { summary = {} as AnalyticsSummary, topProducts = [], ordersByDay = [], recentReviews = [], lowStock = [], activeOrders = [] } = data;
  const showDiscounts = (data.discounts?.cash || 0) > 0 || (data.discounts?.volume || 0) > 0;
  const discountTotal = (data.discounts?.cash || 0) + (data.discounts?.volume || 0);
  const topRevenueTotal = topProducts.reduce((s, p) => s + p.revenue, 0);
  const catRevenueTotal = (data.byCategory || []).reduce((s, c) => s + c.revenue, 0);
  const dowRevenueTotal = (data.byDayOfWeek || []).reduce((s, d) => s + d.revenue, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-xl font-semibold">Estadísticas</h2>
        {isGest ? (
          <div className="flex gap-1.5 flex-wrap">
            {[7, 30, 90, 365].map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`text-xs font-medium rounded-full px-3 py-1.5 transition-colors ${
                  activeRange === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {r === 365 ? "Año" : `${r}d`}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{periodLabel}</span>
        )}
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

          {/* Comparativo mensual: últimos 30 días vs 30 anteriores */}
          {data.monthly && (data.monthly.revenueDelta != null || data.monthly.ordersDelta != null || data.monthly.ticketDelta != null) && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h3 className="font-medium text-sm mb-2">Comparativa mensual (30 días)</h3>
              <div className="flex flex-wrap gap-4">
                <DeltaBadge value={data.monthly.revenueDelta} prefix="ventas" vs="mes anterior" />
                <DeltaBadge value={data.monthly.ordersDelta} prefix="pedidos" vs="mes anterior" />
                <DeltaBadge value={data.monthly.ticketDelta} prefix="ticket prom." vs="mes anterior" />
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
                      <span>{(o.items || []).map((i: any) => i.unit === "kg" ? `${Number(i.qty).toLocaleString("es-AR", { maximumFractionDigits: 3 })}kg ${i.name}` : `${i.qty}x ${i.name}`).join(", ")}</span>
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

          {/* Canal, método y medio de cobro: donas con % de participación */}
          <div className="grid sm:grid-cols-3 gap-4">
            <ShareDonut title="Pedidos por canal" sub="App / mostrador / mesas" entries={toSlices(data.byChannel, CHANNEL_LABEL)} />
            <ShareDonut title="Retiro vs domicilio" entries={toSlices(data.byMethod, METHOD_LABEL)} />
            <ShareDonut title="Medios de cobro" sub="Solo cobrados" entries={toSlices(data.byPay, CASH_METHOD_LABELS)} />
          </div>

          {/* Conversión + descuentos */}
          {data.byChannel && (
            <div className={`grid gap-4 ${showDiscounts ? "sm:grid-cols-2" : ""}`}>
              <div className="border border-border rounded-xl p-4 bg-card">
                <h3 className="font-medium text-sm mb-3">Conversión del período</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Entregados</span>
                    <span className="font-medium">{summary.completedOrders || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Cancelados</span>
                    <span className="font-medium text-red-600">{summary.cancelledOrders || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-border pt-2">
                    <span className="text-muted-foreground">Se completa el</span>
                    <span className="font-bold">
                      {summary.totalOrders != null && summary.totalOrders > 0
                        ? `${Math.round(((summary.completedOrders || 0) / summary.totalOrders) * 100)}%`
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
              {showDiscounts && (
                <div className="border border-border rounded-xl p-4 bg-card">
                  <h3 className="font-medium text-sm mb-3">Descuentos otorgados</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">En efectivo</span>
                      <span className="font-medium">-${(data.discounts?.cash || 0).toLocaleString("es-AR")}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Por volumen</span>
                      <span className="font-medium">-${(data.discounts?.volume || 0).toLocaleString("es-AR")}</span>
                    </div>
                    <div className="flex justify-between text-sm border-t border-border pt-2">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-bold">-${discountTotal.toLocaleString("es-AR")}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {topProducts.length > 0 && (
            <div>
              <h3 className="font-medium text-sm mb-2">Top productos por facturación</h3>
              <div className="space-y-1">
                {topProducts.map((p, i) => {
                  const pct = topRevenueTotal > 0 ? Math.round((p.revenue / topRevenueTotal) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-border last:border-0">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.name}</span>
                      <div className="hidden sm:block w-24 h-2 bg-muted rounded-full overflow-hidden flex-shrink-0">
                        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums w-10 text-right flex-shrink-0">{pct}%</span>
                      <span className="font-medium text-xs tabular-nums w-40 text-right flex-shrink-0">{p.count} un. · ${p.revenue.toLocaleString("es-AR")}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <SalesEvolution data={ordersByDay} range={activeRange} periodLabel={periodLabel} />

          {/* Avanzado - Gestión */}
          {isGest && (
            <>
              <HourlyChart hourly={data.hourly || []} />

              {data.topHours && data.topHours.length > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2">Horarios pico</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {data.topHours.map((h) => (
                      <div key={h.hour} className="border border-border rounded-xl p-3 bg-card text-center">
                        <p className="text-lg font-bold">{h.hour}:00</p>
                        <p className="text-[10px] text-muted-foreground">
                          {h.count} pedidos · ${h.revenue.toLocaleString("es-AR")}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.byDayOfWeek && data.byDayOfWeek.some((d) => d.count > 0) && (
                <div>
                  <h3 className="font-medium text-sm mb-2">Ventas por día de la semana</h3>
                  <div className="space-y-1">
                    {data.byDayOfWeek.map((d) => {
                      const maxRev = Math.max(...data.byDayOfWeek!.map((x) => x.revenue), 1);
                      const pct = dowRevenueTotal > 0 ? Math.round((d.revenue / dowRevenueTotal) * 100) : 0;
                      return (
                        <div key={d.day} className="flex items-center gap-2 text-sm py-0.5">
                          <span className="w-24 flex-shrink-0 text-muted-foreground">{d.day}</span>
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary/70 rounded-full"
                              style={{ width: `${(d.revenue / maxRev) * 100}%` }}
                            />
                          </div>
                          <span className="w-40 text-right text-xs tabular-nums flex-shrink-0">
                            {pct}% · {d.count} ped. · ${d.revenue.toLocaleString("es-AR")}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.deadProducts && data.deadProducts.length > 0 && (
                <div>
                  <h3 className="font-medium text-sm mb-2 text-amber-600">😴 Sin ventas {periodLabel}</h3>
                  <div className="space-y-1">
                    {data.deadProducts.map((p) => (
                      <div key={p.id} className="flex justify-between text-sm py-1 border-b border-border last:border-0">
                        <span>{p.name}</span>
                        <span className="text-muted-foreground text-xs">{p.category}</span>
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
                {data.byCategory.map((c) => {
                  const pct = catRevenueTotal > 0 ? Math.round((c.revenue / catRevenueTotal) * 100) : 0;
                  return (
                    <div key={c.category} className="flex items-center gap-2 text-sm py-1.5 border-b border-border last:border-0">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate">{c.category}</span>
                      <div className="hidden sm:block w-24 h-2 bg-muted rounded-full overflow-hidden flex-shrink-0">
                        <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums w-10 text-right flex-shrink-0">{pct}%</span>
                      <span className="font-medium text-xs tabular-nums w-40 text-right flex-shrink-0">{c.count} un. · ${c.revenue.toLocaleString("es-AR")}</span>
                    </div>
                  );
                })}
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