"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

type Metrics = {
  summary: {
    totalOrders: number;
    last7: number;
    last30: number;
    totalRevenue: number;
    totalVendors: number;
    freeVendors: number;
    paidVendors: number;
    paidPct: number;
    whatsappPct: number;
    activeVendors30d: number;
  };
  perVendor: Array<{ store_name: string; vertical: string; neighborhood: string; orders_30d: number; orders_total: number; completed_total: number; revenue_total: number; quotes_total: number }>;
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

export default function MetricasPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/metrics")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("No se pudieron cargar las métricas"));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <div className="bg-skeleton h-64 rounded-2xl" />;

  const s = data.summary;
  const chartData = data.perVertical.map((v) => ({
    name: v.vertical,
    pedidos: v.orders_total,
  }));

  const fmt = (n: number) => n.toLocaleString("es-AR");
  const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Métricas de lanzamiento</h1>
        <p className="text-sm text-muted-foreground">Primeras 4 semanas: actividad, conversión y planes.</p>
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
          { label: "Free → plan pago", value: `${s.paidPct}%` },
          { label: "Comercios en plan pago", value: `${s.paidVendors}/${s.totalVendors}` },
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

      {/* Per vendor */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-display text-lg font-semibold mb-3">Pedidos por comercio</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2">Comercio</th>
                <th className="py-2">Vertical</th>
                <th className="py-2 text-right">Pedidos (30d)</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Entregados</th>
                <th className="py-2 text-right">Ingresos</th>
                <th className="py-2 text-right">Consultas</th>
              </tr>
            </thead>
            <tbody>
              {data.perVendor.map((v) => (
                <tr key={v.store_name} className="border-t border-border">
                  <td className="py-2 font-medium">{v.store_name}</td>
                  <td className="py-2 capitalize">{v.vertical}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.orders_30d)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.orders_total)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(v.completed_total)}</td>
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