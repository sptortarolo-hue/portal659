"use client";

import { useEffect, useState, useCallback } from "react";
import StatsCard from "@/components/admin/stats-card";
import { Store, Users, ShoppingCart, Package, Star, DollarSign } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { VERTICALS } from "@/lib/config";

type AdminStats = {
  totalVendors: number;
  totalOrders: number;
  totalProducts: number;
  totalReviews: number;
  totalRevenue: number;
  avgRating: number | null;
  totalUsers: number;
};

type Order = {
  id: string;
  created_at: string;
  total: number;
  status: string;
  vendor_id: string;
  vendors?: { store_name: string } | null;
};

type Vendor = {
  id: string;
  store_name: string;
  vertical: string;
  verified: boolean;
};

const VERTICAL_COLORS: Record<string, string> = {
  gastronomia: "#ff6b4a",
  comercio: "#10b981",
  servicio: "#0ea5e9",
  moda: "#8b5cf6",
  salud: "#ec4899",
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  sent: "Enviado",
  completed: "Entregado",
  cancelled: "Cancelado",
};

/** Fetch con timeout: un endpoint colgado no puede congelar el panel. */
async function fetchJson(url: string, ms = 8000): Promise<any | null> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!r.ok) return null;
    return await r.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async () => {
    setError(false);
    try {
      const [adminData, usersData] = await Promise.all([
        fetchJson("/api/admin"),
        fetchJson("/api/admin/users?per_page=1"),
      ]);

      if (adminData && !adminData.error) {
        setStats({
          ...adminData.stats,
          totalUsers: usersData?.total || 0,
        });
        setOrders(adminData.orders || []);
        setVendors(adminData.vendors || []);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ordersByDay = (() => {
    const map: Record<string, number> = {};
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
      map[key] = 0;
    }
    orders.forEach((o) => {
      const d = new Date(o.created_at);
      const key = d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
      if (key in map) map[key]++;
    });
    return Object.entries(map).map(([date, count]) => ({ date, pedidos: count }));
  })();

  const ordersByVertical = (() => {
    const map: Record<string, number> = {};
    vendors.forEach((v) => {
      const count = orders.filter((o) => {
        const vendor = vendors.find((v2) => v2.id === o.vendor_id);
        return vendor?.vertical === v.vertical;
      }).length;
      if (count > 0) map[v.vertical] = (map[v.vertical] || 0) + count;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name: VERTICALS.find((v) => v.slug === name)?.name || name, value }))
      .filter((d) => d.value > 0);
  })();

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-72 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const totalUsers = stats?.totalUsers || 0;

  if (error && !stats) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <div className="border border-red-200 bg-red-50 rounded-xl p-6 text-center space-y-3">
          <p className="font-semibold text-red-700">No se pudieron cargar los datos</p>
          <p className="text-sm text-muted-foreground">
            El servidor no respondió. Revisá la conexión o reintentá.
          </p>
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="rounded-xl bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:bg-primary/90 transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsCard label="Comercios" value={stats?.totalVendors || 0} icon={Store} color="text-primary" />
        <StatsCard label="Usuarios" value={totalUsers} icon={Users} color="text-indigo-600" />
        <StatsCard label="Pedidos" value={stats?.totalOrders || 0} icon={ShoppingCart} color="text-blue-600" />
        <StatsCard label="Productos" value={stats?.totalProducts || 0} icon={Package} color="text-emerald-600" />
        <StatsCard label="Reseñas" value={stats?.totalReviews || 0} icon={Star} color="text-amber-600" />
        <StatsCard
          label="Facturación"
          value={`$${(stats?.totalRevenue || 0).toLocaleString("es-AR")}`}
          icon={DollarSign}
          color="text-green-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border rounded-xl p-4 bg-card">
          <h2 className="font-medium text-sm mb-4">Pedidos últimos 30 días</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={ordersByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="pedidos" fill="var(--primary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-border rounded-xl p-4 bg-card">
          <h2 className="font-medium text-sm mb-4">Pedidos por vertical</h2>
          {ordersByVertical.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={ordersByVertical}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {ordersByVertical.map((entry) => {
                    const v = VERTICALS.find((v2) => v2.name === entry.name);
                    return <Cell key={entry.name} fill={v?.hex || "#8884d8"} />;
                  })}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-12">Sin datos de pedidos</p>
          )}
        </div>
      </div>

      <div className="border border-border rounded-xl p-4 bg-card">
        <h2 className="font-medium text-sm mb-4">Pedidos recientes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Fecha</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Comercio</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Estado</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 10).map((o) => (
                <tr key={o.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-xs">
                    {new Date(o.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="px-3 py-2">{o.vendors?.store_name || "-"}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                      {ORDER_STATUS_LABELS[o.status] || o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">${Number(o.total).toLocaleString("es-AR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
