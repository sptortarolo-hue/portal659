"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, CartesianGrid, Legend } from "recharts";

type Metrics = {
  summary: {
    totalOrders: number;
    last7: number;
    last30: number;
    totalRevenue: number;
    totalVendors: number;
    freeVendors: number;
    paidVendors: number;
    trialVendors: number;
    lapsedVendors: number;
    paidPct: number;
    whatsappPct: number;
    activeVendors30d: number;
    visits30d: number;
    visitors30d: number;
    orderRate: number;
    funnelRate: number;
  };
  perVendor: Array<{ store_name: string; vertical: string; neighborhood: string; orders_30d: number; orders_total: number; completed_total: number; completed_30d: number; app_completed_30d: number; revenue_total: number; quotes_total: number; visits_30d: number; visitors_30d: number; conv_rate: number }>;
  perVertical: Array<{ vertical: string; vendors: number; orders_total: number; completed_total: number; revenue_total: number }>;
  byPayment: Array<{ payment_method: string; n: number }>;
  byChannel: Array<{ channel: string; n: number }>;
  plans: Array<{ slug: string; name: string; price: number }>;
};

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "#ff6b4a",
  comercio: "#10b981",
  servicio: "#0ea5e9",
  moda: "#8b5cf6",
  salud: "#ec4899",
  varios: "#f59e0b",
  mascotas: "#14b8a6",
};

type Traffic = {
  ready: boolean;
  daily: Array<{ day: string; views: number; visitors: number }>;
  topPaths: Array<{ path: string; views: number; uniques: number }>;
  topSearches: Array<{ value: string; n: number }>;
  waTotal: number;
  storeOpenTotal: number;
  waByVendor: Array<{ store_name: string; n: number }>;
};

export default function MetricasPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    fetch("/api/admin/metrics")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error || `Error ${r.status}`);
        if (!d || d.error) throw new Error(d?.error || "Respuesta inválida");
        setData({
          summary: d.summary,
          perVendor: Array.isArray(d.perVendor) ? d.perVendor : [],
          perVertical: Array.isArray(d.perVertical) ? d.perVertical : [],
          byPayment: Array.isArray(d.byPayment) ? d.byPayment : [],
          byChannel: Array.isArray(d.byChannel) ? d.byChannel : [],
          plans: Array.isArray(d.plans) ? d.plans : [],
        });
      })
      .catch(() => setError("No se pudieron cargar las métricas"));
    // Tráfico e interacción (independiente de las métricas de venta).
    fetch("/api/admin/traffic")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok && d && !d.error) setTraffic(d);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <div className="border border-red-200 bg-red-50 text-red-700 rounded-2xl px-4 py-3 text-sm flex items-center justify-between gap-3">
        <span>{error}</span>
        <button
          onClick={load}
          className="shrink-0 rounded-full border border-red-300 bg-white px-4 py-1.5 text-xs font-semibold hover:bg-red-100 transition-colors"
        >
          Reintentar
        </button>
      </div>
    );
  if (!data) return <div className="bg-skeleton h-64 rounded-2xl" />;

  const s = data.summary;
  const chartData = data.perVertical.map((v) => ({
    name: v.vertical,
    pedidos: v.orders_total,
  }));

  const fmt = (n: number | string) => Number(n ?? 0).toLocaleString("es-AR");
  const money = (n: number | string) => `$${Math.round(Number(n ?? 0)).toLocaleString("es-AR")}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Métricas de lanzamiento</h1>
        <p className="text-sm text-muted-foreground">
          Solo comercios visibles en el portal (sin pruebas). El funnel de visitas compara
          únicamente pedidos del canal app (mostrador/mesas/directas no entran a ese %).
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {[
          { label: "Pedidos totales", value: fmt(s.totalOrders) },
          { label: "Últimos 7 días", value: fmt(s.last7) },
          { label: "Últimos 30 días", value: fmt(s.last30) },
          { label: "Ingresos (entregados)", value: money(s.totalRevenue) },
          { label: "Comercios con pedidos (30d)", value: fmt(s.activeVendors30d) },
          { label: "Vía WhatsApp", value: `${s.whatsappPct}%` },
          { label: "Free → plan pago activo", value: `${s.paidPct}%` },
          { label: "Plan pago activo", value: `${s.paidVendors}` },
          { label: "En prueba (trial)", value: fmt(s.trialVendors ?? 0) },
          { label: "Vencidos/cancelados con plan", value: fmt(s.lapsedVendors ?? 0) },
          { label: "Únicos por comercio (30d)", value: fmt(s.visitors30d) },
          { label: "Piden tras visitar (app)", value: `${s.orderRate}%` },
          { label: "Completan compra (app)", value: `${s.funnelRate}%` },
        ].map((c) => (
          <div key={c.label} className="bg-card border border-border rounded-2xl p-4">
            <div className="text-xl font-bold tabular-nums">{c.value}</div>
            <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Per vertical chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-display text-lg font-semibold mb-3">Pedidos por vertical (qué engancha)</h2>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay pedidos.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="pedidos" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={VERTICAL_COLORS[entry.name] || "#8884d8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Payment / channel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Método de pago</h2>
          <table className="w-full text-sm">
            <tbody>
              {data.byPayment.map((r) => (
                <tr key={r.payment_method || "sin dato"} className="border-b border-border last:border-0">
                  <td className="py-2 capitalize">{r.payment_method || "sin dato"}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{fmt(r.n)}</td>
                </tr>
              ))}
              {data.byPayment.length === 0 && (
                <tr><td className="py-2 text-muted-foreground">Sin datos</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-display text-lg font-semibold mb-3">Canal de pedido</h2>
          <table className="w-full text-sm">
            <tbody>
              {data.byChannel.map((r) => (
                <tr key={r.channel} className="border-b border-border last:border-0">
                  <td className="py-2 capitalize">{r.channel}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{fmt(r.n)}</td>
                </tr>
              ))}
              {data.byChannel.length === 0 && (
                <tr><td className="py-2 text-muted-foreground">Sin datos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Traffic & interaction */}
      {traffic && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="font-display text-lg font-semibold">Tráfico e interacción (30d)</h2>
            <span className="text-[11px] text-muted-foreground">
              Clicks WhatsApp: {fmt(traffic.waTotal)} · Apertura de tiendas: {fmt(traffic.storeOpenTotal)}
            </span>
          </div>
          {!traffic.ready ? (
            <p className="text-sm text-muted-foreground">
              Falta aplicar <code className="text-xs">migrate-portal-analytics.sql</code> en la base para el tracking de páginas/búsquedas/clicks.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Vistas de página por día (línea baja = visitantes únicos)</p>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={traffic.daily.map((d) => ({ ...d, label: d.day.slice(5) }))} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                        <defs>
                          <linearGradient id="tv" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#8884" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip />
                        <Area type="monotone" dataKey="views" stroke="#6366f1" fill="url(#tv)" name="Vistas" />
                        <Area type="monotone" dataKey="visitors" stroke="#10b981" fill="none" name="Únicos" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Tap WhatsApp (eligen escribir) por comercio</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {traffic.waByVendor.length === 0 && (
                        <tr><td className="py-2 text-muted-foreground">Sin clicks todavía</td></tr>
                      )}
                      {traffic.waByVendor.map((r) => (
                        <tr key={r.store_name} className="border-b border-border last:border-0">
                          <td className="py-1.5">{r.store_name}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmt(r.n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Páginas más vistas</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {traffic.topPaths.map((r) => (
                        <tr key={r.path} className="border-b border-border last:border-0">
                          <td className="py-1.5 font-mono text-xs truncate max-w-[12rem]">{r.path}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmt(r.views)}</td>
                          <td className="py-1.5 text-right text-muted-foreground tabular-nums text-xs">{fmt(r.uniques)} únicos</td>
                        </tr>
                      ))}
                      {traffic.topPaths.length === 0 && (
                        <tr><td className="py-2 text-muted-foreground">Sin datos</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Búsquedas (término y rubros desde el buscador)</p>
                  <table className="w-full text-sm">
                    <tbody>
                      {traffic.topSearches.map((r) => (
                        <tr key={r.value} className="border-b border-border last:border-0">
                          <td className="py-1.5 truncate max-w-[14rem]">{r.value.startsWith("vertical:") ? `🏷️ ${r.value.slice(9)}` : `🔍 ${r.value}`}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmt(r.n)}</td>
                        </tr>
                      ))}
                      {traffic.topSearches.length === 0 && (
                        <tr><td className="py-2 text-muted-foreground">Sin búsquedas</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per vendor */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-display text-lg font-semibold mb-3">Pedidos por comercio</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2">Comercio</th>
                <th className="py-2">Vertical</th>
                <th className="py-2 text-right">Únicos (30d)</th>
                <th className="py-2 text-right">Pedidos (30d)</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Entregados</th>
                <th className="py-2 text-right">Conv. %</th>
                <th className="py-2 text-right">Ingresos</th>
                <th className="py-2 text-right">Consultas</th>
              </tr>
            </thead>
            <tbody>
              {data.perVendor.map((v) => (
                <tr key={v.store_name} className="border-t border-border">
                  <td className="py-2 font-medium">{v.store_name}</td>
                  <td className="py-2 capitalize">{v.vertical}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.visitors_30d)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.orders_30d)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.orders_total)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.completed_total)}</td>
                  <td className="py-2 text-right tabular-nums">{Number(v.conv_rate ?? 0)}%</td>
                  <td className="py-2 text-right tabular-nums">{money(v.revenue_total)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.quotes_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}